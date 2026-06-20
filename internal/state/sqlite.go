package state

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
	_ "modernc.org/sqlite"
)

// parserVersion tracks the Claude/Codex token-parsing logic. Bump it whenever
// that logic changes so existing local caches are dropped and re-parsed on the
// next run, and the corrected sessions are re-uploaded.
//
// v3: session summaries are aggregated from usage_calls across every source file
// that shares a session_hash, so Claude's separate subagent files
// (<session>/subagents/agent-*.jsonl, written with the parent's sessionId) are
// rolled into the parent session instead of clobbering it.
//
// v4: subagent breakdown — per-file agent rows (session_agents) plus Codex root
// resolution that rolls subagent threads (separate session ids) onto their
// parent session_hash.
//
// v5: Claude nesting — spawn labels are extracted from subagent files too (not
// just the main file), and depth is reconstructed by walking the spawn chain so
// nested subagents (a subagent spawning a subagent) indent correctly.
//
// v6: a spawn is only recorded when a bare "agentId: …" string has a matching
// Agent/Task tool_use, so agent ids echoed in shell output aren't mistaken for
// real subagents (which created empty 0-token agent rows).
const parserVersion = 6

type Store struct {
	db *sql.DB
}

var kst = time.FixedZone("KST", 9*60*60)

type SourceFile struct {
	SizeBytes     int64
	ModifiedAt    string
	HasUsageCalls bool
	Session       usage.SessionSummary
}

type SessionRow struct {
	Provider  string
	UpdatedAt string
	usage.SessionSummary
}

type UsageCallRow struct {
	Provider    string
	SessionHash string
	UpdatedAt   string
	usage.UsageCall
}

type DailyUsageRow struct {
	UsageDate      string
	Provider       string
	Model          string
	SessionCount   int
	LLMCallCount   int
	InputTokens    int
	OutputTokens   int
	CacheTokens    int
	FirstUsedAt    string
	LastUsedAt     string
	LocalUpdatedAt string
}

type SessionAgentRow struct {
	Provider       string
	SessionHash    string
	AgentKey       string
	ParentAgentKey string
	Depth          int
	LabelType      string
	LabelText      string
	InputTokens    int
	OutputTokens   int
	CacheTokens    int
	LLMCallCount   int
	UserTurnCount  int
	StartedAt      string
	EndedAt        string
	UpdatedAt      string
}

type LocalDevice struct {
	DeviceID    string
	DeviceLabel string
	Platform    string
	CreatedAt   string
	UpdatedAt   string
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	store := &Store{db: db}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.normalizeTimestamps(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error {
	return store.db.Close()
}

func (store *Store) ListSessions(ctx context.Context) ([]SessionRow, error) {
	return store.listSessions(ctx, "")
}

func (store *Store) ListPendingSessions(ctx context.Context) ([]SessionRow, error) {
	return store.listSessions(ctx, "where need_sync = 1")
}

func (store *Store) EnsureLocalDevice(ctx context.Context) (LocalDevice, error) {
	label := defaultDeviceLabel()
	platform := runtime.GOOS

	var device LocalDevice
	err := store.db.QueryRowContext(ctx, `
		select device_id, device_label, platform, created_at, updated_at
		from local_device
		order by created_at, device_id
		limit 1
	`).Scan(&device.DeviceID, &device.DeviceLabel, &device.Platform, &device.CreatedAt, &device.UpdatedAt)
	if err != nil && err != sql.ErrNoRows {
		return LocalDevice{}, err
	}
	if err == nil {
		if device.DeviceLabel == label && device.Platform == platform {
			return device, nil
		}
		now := time.Now().In(kst).Format(time.RFC3339Nano)
		if _, err := store.db.ExecContext(ctx, `
			update local_device
			set device_label = ?, platform = ?, updated_at = ?
			where device_id = ?
		`, label, platform, now, device.DeviceID); err != nil {
			return LocalDevice{}, err
		}
		device.DeviceLabel = label
		device.Platform = platform
		device.UpdatedAt = now
		return device, nil
	}

	deviceID := machineDerivedDeviceID()
	if deviceID == "" {
		randomID, err := newUUIDV4()
		if err != nil {
			return LocalDevice{}, err
		}
		deviceID = randomID
	}
	now := time.Now().In(kst).Format(time.RFC3339Nano)
	device = LocalDevice{
		DeviceID:    deviceID,
		DeviceLabel: label,
		Platform:    platform,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := store.db.ExecContext(ctx, `
		insert into local_device (
			device_id,
			device_label,
			platform,
			created_at,
			updated_at
		) values (?, ?, ?, ?, ?)
	`, device.DeviceID, device.DeviceLabel, device.Platform, device.CreatedAt, device.UpdatedAt); err != nil {
		return LocalDevice{}, err
	}
	return device, nil
}

func (store *Store) ListPendingUsageCalls(ctx context.Context) ([]UsageCallRow, error) {
	rows, err := store.db.QueryContext(ctx, `
		select
			uc.provider,
			uc.session_hash,
			uc.call_key,
			uc.call_index,
			uc.occurred_at,
			coalesce(uc.model, ''),
			uc.input_tokens,
			uc.output_tokens,
			uc.cache_tokens,
			uc.updated_at
		from usage_calls uc
		join sessions s
		  on s.provider = uc.provider
		 and s.session_hash = uc.session_hash
		where s.need_sync = 1
		order by uc.provider, uc.session_hash, uc.call_index, uc.call_key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var calls []UsageCallRow
	for rows.Next() {
		var call UsageCallRow
		if err := rows.Scan(
			&call.Provider,
			&call.SessionHash,
			&call.CallKey,
			&call.CallIndex,
			&call.OccurredAt,
			&call.Model,
			&call.Tokens.Input,
			&call.Tokens.Output,
			&call.Tokens.Cache,
			&call.UpdatedAt,
		); err != nil {
			return nil, err
		}
		calls = append(calls, call)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return calls, nil
}

// ListPendingSessionAgents returns the subagent breakdown rows for every session
// pending sync, so the parent session and its agents upload together.
func (store *Store) ListPendingSessionAgents(ctx context.Context) ([]SessionAgentRow, error) {
	rows, err := store.db.QueryContext(ctx, `
		select
			sa.provider,
			sa.session_hash,
			sa.agent_key,
			sa.parent_agent_key,
			sa.depth,
			sa.label_type,
			sa.label_text,
			sa.input_tokens,
			sa.output_tokens,
			sa.cache_tokens,
			sa.llm_call_count,
			sa.user_turn_count,
			sa.started_at,
			sa.ended_at,
			sa.updated_at
		from session_agents sa
		join sessions s
		  on s.provider = sa.provider
		 and s.session_hash = sa.session_hash
		where s.need_sync = 1
		order by sa.provider, sa.session_hash, sa.depth, sa.agent_key
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []SessionAgentRow
	for rows.Next() {
		var agent SessionAgentRow
		if err := rows.Scan(
			&agent.Provider,
			&agent.SessionHash,
			&agent.AgentKey,
			&agent.ParentAgentKey,
			&agent.Depth,
			&agent.LabelType,
			&agent.LabelText,
			&agent.InputTokens,
			&agent.OutputTokens,
			&agent.CacheTokens,
			&agent.LLMCallCount,
			&agent.UserTurnCount,
			&agent.StartedAt,
			&agent.EndedAt,
			&agent.UpdatedAt,
		); err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return agents, nil
}

func (store *Store) ListPendingDailyUsage(ctx context.Context) ([]DailyUsageRow, error) {
	rows, err := store.db.QueryContext(ctx, `
		with affected_days as (
			select distinct
				uc.provider,
				substr(uc.occurred_at, 1, 10) as usage_date
			from usage_calls uc
			join sessions s
			  on s.provider = uc.provider
			 and s.session_hash = uc.session_hash
			where s.need_sync = 1
		)
		select
			affected_days.usage_date,
			uc.provider,
			coalesce(uc.model, '') as model,
			count(distinct uc.session_hash) as session_count,
			count(*) as llm_call_count,
			coalesce(sum(uc.input_tokens), 0) as input_tokens,
			coalesce(sum(uc.output_tokens), 0) as output_tokens,
			coalesce(sum(uc.cache_tokens), 0) as cache_tokens,
			min(uc.occurred_at) as first_used_at,
			max(uc.occurred_at) as last_used_at,
			max(uc.updated_at) as local_updated_at
		from affected_days
		join usage_calls uc
		  on uc.provider = affected_days.provider
		 and substr(uc.occurred_at, 1, 10) = affected_days.usage_date
		group by affected_days.usage_date, uc.provider, coalesce(uc.model, '')
		order by affected_days.usage_date, uc.provider, coalesce(uc.model, '')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var daily []DailyUsageRow
	for rows.Next() {
		var row DailyUsageRow
		if err := rows.Scan(
			&row.UsageDate,
			&row.Provider,
			&row.Model,
			&row.SessionCount,
			&row.LLMCallCount,
			&row.InputTokens,
			&row.OutputTokens,
			&row.CacheTokens,
			&row.FirstUsedAt,
			&row.LastUsedAt,
			&row.LocalUpdatedAt,
		); err != nil {
			return nil, err
		}
		daily = append(daily, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return daily, nil
}

func (store *Store) listSessions(ctx context.Context, where string) ([]SessionRow, error) {
	query := `
		select
			provider,
			session_hash,
			started_at,
			ended_at,
			user_turn_count,
			llm_call_count,
			input_tokens,
			output_tokens,
			cache_tokens,
			updated_at
		from sessions
		` + where + `
		order by started_at, provider, session_hash
	`
	rows, err := store.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []SessionRow
	for rows.Next() {
		var session SessionRow
		if err := rows.Scan(
			&session.Provider,
			&session.SessionHash,
			&session.StartedAt,
			&session.EndedAt,
			&session.UserTurnCount,
			&session.LLMCallCount,
			&session.Tokens.Input,
			&session.Tokens.Output,
			&session.Tokens.Cache,
			&session.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return sessions, nil
}

func (store *Store) MarkSessionsSynced(ctx context.Context, sessions []SessionRow) error {
	if len(sessions) == 0 {
		return nil
	}
	now := time.Now().In(kst).Format(time.RFC3339Nano)
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, session := range sessions {
		if _, err := tx.ExecContext(ctx, `
			update sessions
			set need_sync = 0, synced_at = ?
			where provider = ? and session_hash = ? and updated_at = ?
		`, now, session.Provider, session.SessionHash, session.UpdatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (store *Store) MarkAllSessionsPendingSync(ctx context.Context) error {
	_, err := store.db.ExecContext(ctx, `
		update sessions
		set need_sync = 1, synced_at = null
	`)
	return err
}

func (store *Store) SourceFile(ctx context.Context, provider string, fileKey string) (SourceFile, bool, error) {
	row := store.db.QueryRowContext(ctx, `
		select
			sf.size_bytes,
			sf.modified_at,
			exists(
				select 1
				from usage_calls uc
				where uc.provider = sf.provider
				  and uc.session_hash = sf.session_hash
				  and uc.source_file_key = sf.file_key
			),
			s.session_hash,
			s.started_at,
			s.ended_at,
			s.user_turn_count,
			s.llm_call_count,
			s.input_tokens,
			s.output_tokens,
			s.cache_tokens
		from source_files sf
		join sessions s on s.session_hash = sf.session_hash
		where sf.file_key = ? and sf.provider = ?
	`, fileKey, provider)

	var source SourceFile
	var session usage.SessionSummary
	err := row.Scan(
		&source.SizeBytes,
		&source.ModifiedAt,
		&source.HasUsageCalls,
		&session.SessionHash,
		&session.StartedAt,
		&session.EndedAt,
		&session.UserTurnCount,
		&session.LLMCallCount,
		&session.Tokens.Input,
		&session.Tokens.Output,
		&session.Tokens.Cache,
	)
	if err == sql.ErrNoRows {
		return SourceFile{}, false, nil
	}
	if err != nil {
		return SourceFile{}, false, err
	}
	source.Session = session
	return source, true, nil
}

func (store *Store) UpsertSourceFile(ctx context.Context, provider string, fileKey string, sizeBytes int64, modifiedAt string, session usage.SessionSummary) error {
	return store.UpsertParsedSourceFile(ctx, provider, fileKey, sizeBytes, modifiedAt, usage.SessionUsage{
		Summary: session,
	})
}

func (store *Store) UpsertParsedSourceFile(ctx context.Context, provider string, fileKey string, sizeBytes int64, modifiedAt string, parsed usage.SessionUsage) error {
	now := time.Now().In(kst).Format(time.RFC3339Nano)
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		delete from usage_calls
		where provider = ? and source_file_key = ?
	`, provider, fileKey); err != nil {
		return err
	}
	for _, call := range parsed.Calls {
		if _, err := tx.ExecContext(ctx, `
			insert into usage_calls (
				provider,
				session_hash,
				call_key,
				call_index,
				occurred_at,
				model,
				input_tokens,
				output_tokens,
				cache_tokens,
				source_file_key,
				updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			on conflict(provider, session_hash, call_key) do update set
				call_index = excluded.call_index,
				occurred_at = excluded.occurred_at,
				model = excluded.model,
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cache_tokens = excluded.cache_tokens,
				source_file_key = excluded.source_file_key,
				updated_at = excluded.updated_at
		`, provider, parsed.Summary.SessionHash, call.CallKey, call.CallIndex, call.OccurredAt, nullableString(call.Model), call.Tokens.Input, call.Tokens.Output, call.Tokens.Cache, fileKey, now); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		insert into source_files (
			file_key,
			provider,
			size_bytes,
			modified_at,
			session_hash,
			last_parsed_at,
			own_session_id,
			parent_session_id
		) values (?, ?, ?, ?, ?, ?, ?, ?)
		on conflict(file_key) do update set
			provider = excluded.provider,
			size_bytes = excluded.size_bytes,
			modified_at = excluded.modified_at,
			session_hash = excluded.session_hash,
			last_parsed_at = excluded.last_parsed_at,
			own_session_id = excluded.own_session_id,
			parent_session_id = excluded.parent_session_id
	`, fileKey, provider, sizeBytes, modifiedAt, parsed.Summary.SessionHash, now, parsed.OwnSessionID, parsed.ParentSessionID); err != nil {
		return err
	}

	// Recompute the session summary by aggregating every usage_call mapped to this
	// session_hash. Claude writes subagent turns to separate files
	// (<session>/subagents/agent-*.jsonl) that carry the parent's sessionId, so two
	// source files share one session_hash; deriving totals from usage_calls rolls
	// them up instead of letting the last-parsed file clobber the summary, and keeps
	// the session in lockstep with the usage_calls-based daily rollup. user_turn_count
	// can't come from calls, so we keep the largest per-file human-prompt count (a
	// subagent file contributes the same or fewer prompts than its parent).
	if _, err := tx.ExecContext(ctx, `
		insert into sessions (
			session_hash,
			provider,
			started_at,
			ended_at,
			user_turn_count,
			llm_call_count,
			input_tokens,
			output_tokens,
			cache_tokens,
			updated_at,
			need_sync,
			synced_at
		)
		select
			?,
			?,
			coalesce(min(occurred_at), ?),
			coalesce(max(occurred_at), ?),
			?,
			case when count(*) > 0 then count(*) else ? end,
			case when count(*) > 0 then coalesce(sum(input_tokens), 0) else ? end,
			case when count(*) > 0 then coalesce(sum(output_tokens), 0) else ? end,
			case when count(*) > 0 then coalesce(sum(cache_tokens), 0) else ? end,
			?,
			1,
			null
		from usage_calls
		where provider = ? and session_hash = ?
		on conflict(session_hash) do update set
			provider = excluded.provider,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			user_turn_count = max(sessions.user_turn_count, excluded.user_turn_count),
			llm_call_count = excluded.llm_call_count,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_tokens = excluded.cache_tokens,
			updated_at = excluded.updated_at,
			need_sync = 1,
			synced_at = null
	`, parsed.Summary.SessionHash, provider,
		parsed.Summary.StartedAt, parsed.Summary.EndedAt,
		parsed.Summary.UserTurnCount,
		parsed.Summary.LLMCallCount,
		parsed.Summary.Tokens.Input, parsed.Summary.Tokens.Output, parsed.Summary.Tokens.Cache,
		now, provider, parsed.Summary.SessionHash); err != nil {
		return err
	}

	// Record this file's contribution as one "agent" (the main turn or one
	// subagent) under the session. Token/call/time come from this file's
	// usage_calls; identity/label from the parser. The label is upserted only when
	// non-empty so Claude's split sources (subagent file = tokens, main file =
	// label) don't clobber each other regardless of parse order.
	if agentKey := parsed.Agent.AgentKey; agentKey != "" {
		if _, err := tx.ExecContext(ctx, `
			insert into session_agents (
				provider, session_hash, agent_key, parent_agent_key, depth,
				label_type, label_text,
				input_tokens, output_tokens, cache_tokens, llm_call_count, user_turn_count,
				started_at, ended_at, source_file_key, updated_at
			)
			select
				?, ?, ?, ?, ?,
				?, ?,
				coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0), coalesce(sum(cache_tokens), 0),
				count(*), ?,
				coalesce(min(occurred_at), ?), coalesce(max(occurred_at), ?), ?, ?
			from usage_calls
			where provider = ? and source_file_key = ?
			on conflict(provider, session_hash, agent_key) do update set
				parent_agent_key = case when excluded.parent_agent_key != '' then excluded.parent_agent_key else session_agents.parent_agent_key end,
				depth = case when excluded.depth != 0 then excluded.depth else session_agents.depth end,
				label_type = case when excluded.label_type != '' then excluded.label_type else session_agents.label_type end,
				label_text = case when excluded.label_text != '' then excluded.label_text else session_agents.label_text end,
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cache_tokens = excluded.cache_tokens,
				llm_call_count = excluded.llm_call_count,
				user_turn_count = excluded.user_turn_count,
				started_at = excluded.started_at,
				ended_at = excluded.ended_at,
				source_file_key = excluded.source_file_key,
				updated_at = excluded.updated_at
		`, provider, parsed.Summary.SessionHash, agentKey, parsed.Agent.ParentKey, parsed.Agent.Depth,
			parsed.Agent.LabelType, parsed.Agent.LabelText,
			parsed.Summary.UserTurnCount,
			parsed.Summary.StartedAt, parsed.Summary.EndedAt, fileKey, now,
			provider, fileKey); err != nil {
			return err
		}
	}

	// Apply labels this file knows about other agents it spawned (Claude main
	// file's Agent/Task calls → agentId). Insert a label-only stub if the
	// subagent's own row hasn't been parsed yet; never overwrite tokens.
	for _, label := range parsed.AgentLabels {
		if label.AgentKey == "" {
			continue
		}
		parentKey := label.ParentKey
		if parentKey == "" {
			parentKey = "main"
		}
		if _, err := tx.ExecContext(ctx, `
			insert into session_agents (
				provider, session_hash, agent_key, parent_agent_key, depth,
				label_type, label_text, updated_at
			) values (?, ?, ?, ?, 0, ?, ?, ?)
			on conflict(provider, session_hash, agent_key) do update set
				parent_agent_key = case when excluded.parent_agent_key != '' then excluded.parent_agent_key else session_agents.parent_agent_key end,
				label_type = case when excluded.label_type != '' then excluded.label_type else session_agents.label_type end,
				label_text = case when excluded.label_text != '' then excluded.label_text else session_agents.label_text end,
				updated_at = excluded.updated_at
		`, provider, parsed.Summary.SessionHash, label.AgentKey, parentKey, label.LabelType, label.LabelText, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ResolveSessionRoots rolls Codex subagent files — each written under its own
// session id — up to their root parent session, so a spawned thread's calls and
// agent row move onto the parent's session_hash and the subagent stops showing as
// a separate session. Linkage comes from source_files.{own,parent}_session_id.
// Claude subagent files already share the parent's session id (parent_session_id
// empty), so every node is its own root and this is a no-op for them.
func (store *Store) ResolveSessionRoots(ctx context.Context, provider string) error {
	rows, err := store.db.QueryContext(ctx, `
		select own_session_id, parent_session_id
		from source_files
		where provider = ? and own_session_id != ''
	`, provider)
	if err != nil {
		return err
	}
	parent := map[string]string{}
	var owns []string
	for rows.Next() {
		var own, par string
		if err := rows.Scan(&own, &par); err != nil {
			rows.Close()
			return err
		}
		if _, seen := parent[own]; !seen {
			owns = append(owns, own)
		}
		parent[own] = strings.TrimSpace(par)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	type remap struct{ oldHash, newHash string }
	var remaps []remap
	roots := map[string]struct{}{}
	for _, own := range owns {
		root := resolveRoot(own, parent)
		roots[usage.HashSessionID(provider, root)] = struct{}{}
		if root != own {
			remaps = append(remaps, remap{
				oldHash: usage.HashSessionID(provider, own),
				newHash: usage.HashSessionID(provider, root),
			})
		}
	}
	if len(remaps) == 0 {
		return nil
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().In(kst).Format(time.RFC3339Nano)

	for _, r := range remaps {
		if r.oldHash == r.newHash {
			continue
		}
		if _, err := tx.ExecContext(ctx, `update usage_calls set session_hash = ? where provider = ? and session_hash = ?`, r.newHash, provider, r.oldHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `update session_agents set session_hash = ? where provider = ? and session_hash = ?`, r.newHash, provider, r.oldHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `update source_files set session_hash = ? where provider = ? and session_hash = ?`, r.newHash, provider, r.oldHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `delete from sessions where provider = ? and session_hash = ?`, provider, r.oldHash); err != nil {
			return err
		}
	}

	// Recompute token/call/time aggregates for each affected root from usage_calls.
	// user_turn_count is left as the root's own human-prompt count (subagents
	// receive prompts but add no human turns to the rolled-up session).
	for rootHash := range roots {
		if _, err := tx.ExecContext(ctx, `
			update sessions set
				input_tokens = (select coalesce(sum(input_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				output_tokens = (select coalesce(sum(output_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_tokens = (select coalesce(sum(cache_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				llm_call_count = (select count(*) from usage_calls where provider = ? and session_hash = ?),
				started_at = coalesce((select min(occurred_at) from usage_calls where provider = ? and session_hash = ?), started_at),
				ended_at = coalesce((select max(occurred_at) from usage_calls where provider = ? and session_hash = ?), ended_at),
				updated_at = ?, need_sync = 1, synced_at = null
			where provider = ? and session_hash = ?
		`, provider, rootHash, provider, rootHash, provider, rootHash, provider, rootHash, provider, rootHash, provider, rootHash, now, provider, rootHash); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ResolveAgentDepths computes each agent's nesting depth from the spawn chain.
// Claude doesn't record depth, so a subagent that spawns another subagent must be
// reconstructed by walking parent_agent_key back to "main". Codex carries an
// authoritative thread_spawn depth (and its root uses agent_key "main" while
// children point at the parent thread id, so the chain wouldn't reach "main"), so
// this only runs for Claude.
func (store *Store) ResolveAgentDepths(ctx context.Context, provider string) error {
	if provider != "claude" {
		return nil
	}
	rows, err := store.db.QueryContext(ctx, `
		select session_hash, agent_key, parent_agent_key
		from session_agents
		where provider = ?
	`, provider)
	if err != nil {
		return err
	}
	type node struct{ session, key, parent string }
	var nodes []node
	parentsBySession := map[string]map[string]string{}
	for rows.Next() {
		var n node
		if err := rows.Scan(&n.session, &n.key, &n.parent); err != nil {
			rows.Close()
			return err
		}
		nodes = append(nodes, n)
		if parentsBySession[n.session] == nil {
			parentsBySession[n.session] = map[string]string{}
		}
		parentsBySession[n.session][n.key] = n.parent
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, n := range nodes {
		depth := computeAgentDepth(n.key, parentsBySession[n.session])
		if _, err := tx.ExecContext(ctx, `
			update session_agents set depth = ?
			where provider = ? and session_hash = ? and agent_key = ?
		`, depth, provider, n.session, n.key); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func computeAgentDepth(key string, parents map[string]string) int {
	if key == "main" {
		return 0
	}
	depth := 0
	cur := key
	seen := map[string]struct{}{}
	for cur != "" && cur != "main" {
		if _, ok := seen[cur]; ok {
			break
		}
		seen[cur] = struct{}{}
		parent, ok := parents[cur]
		if !ok || parent == "" {
			break
		}
		depth++
		cur = parent
	}
	if depth == 0 {
		depth = 1
	}
	return depth
}

// resolveRoot walks own→parent links to the topmost ancestor. If a parent id is
// not among the parsed files, the node is kept as its own root so its session
// stays visible rather than merging into a phantom hash.
func resolveRoot(own string, parent map[string]string) string {
	seen := map[string]struct{}{}
	cur := own
	for {
		if _, ok := seen[cur]; ok {
			return cur
		}
		seen[cur] = struct{}{}
		par := parent[cur]
		if par == "" {
			return cur
		}
		if _, ok := parent[par]; !ok {
			return own
		}
		cur = par
	}
}

func (store *Store) DeleteSourceFile(ctx context.Context, provider string, fileKey string) error {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `delete from usage_calls where source_file_key = ? and provider = ?`, fileKey, provider); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from source_files where file_key = ? and provider = ?`, fileKey, provider); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *Store) migrate(ctx context.Context) error {
	_, err := store.db.ExecContext(ctx, `
		create table if not exists sessions (
			session_hash text primary key,
			provider text not null,
			started_at text not null,
			ended_at text not null,
			user_turn_count integer not null,
			llm_call_count integer not null,
			input_tokens integer not null,
			output_tokens integer not null,
			cache_tokens integer not null,
			updated_at text not null,
			need_sync integer not null default 1,
			synced_at text
		);

		create table if not exists source_files (
			file_key text primary key,
			provider text not null,
			size_bytes integer not null,
			modified_at text not null,
			session_hash text not null,
			last_parsed_at text not null,
			foreign key(session_hash) references sessions(session_hash)
		);

		create table if not exists usage_calls (
			provider text not null,
			session_hash text not null,
			call_key text not null,
			call_index integer not null,
			occurred_at text not null,
			model text,
			input_tokens integer not null,
			output_tokens integer not null,
			cache_tokens integer not null,
			source_file_key text not null,
			updated_at text not null,
			primary key(provider, session_hash, call_key),
			foreign key(session_hash) references sessions(session_hash)
		);

		create table if not exists session_agents (
			provider text not null,
			session_hash text not null,
			agent_key text not null,
			parent_agent_key text not null default '',
			depth integer not null default 0,
			label_type text not null default '',
			label_text text not null default '',
			input_tokens integer not null default 0,
			output_tokens integer not null default 0,
			cache_tokens integer not null default 0,
			llm_call_count integer not null default 0,
			user_turn_count integer not null default 0,
			started_at text not null default '',
			ended_at text not null default '',
			source_file_key text not null default '',
			updated_at text not null,
			primary key(provider, session_hash, agent_key)
		);

		create table if not exists local_device (
			device_id text primary key,
			device_label text not null,
			platform text not null,
			created_at text not null,
			updated_at text not null
		);

		create table if not exists meta (
			key text primary key,
			value text not null
		);

		create index if not exists idx_sessions_provider_started_at on sessions(provider, started_at);
		create index if not exists idx_source_files_provider_modified_at on source_files(provider, modified_at);
		create index if not exists idx_usage_calls_session on usage_calls(provider, session_hash, call_index);
		create index if not exists idx_usage_calls_source_file on usage_calls(provider, source_file_key);
		create index if not exists idx_session_agents_session on session_agents(provider, session_hash);
	`)
	if err != nil {
		return err
	}
	if err := store.ensureSessionSyncColumns(ctx); err != nil {
		return err
	}
	if err := store.ensureSourceFileLinkageColumns(ctx); err != nil {
		return err
	}
	if err := store.dropRemovedTokenColumns(ctx); err != nil {
		return err
	}
	if _, err = store.db.ExecContext(ctx, `
		create index if not exists idx_sessions_need_sync on sessions(need_sync, provider, started_at);
	`); err != nil {
		return err
	}
	return store.applyParserVersion(ctx)
}

// applyParserVersion drops the cached source files and marks every session for
// re-sync when the stored parser version is older than the current one, so the
// next inspect re-parses all files with the updated logic and re-uploads the
// corrected totals. A missing marker is treated as version 0 (covers upgrades
// from binaries that predate this table).
func (store *Store) applyParserVersion(ctx context.Context) error {
	stored := 0
	var raw string
	switch err := store.db.QueryRowContext(ctx, `select value from meta where key = 'parser_version'`).Scan(&raw); err {
	case nil:
		stored, _ = strconv.Atoi(strings.TrimSpace(raw))
	case sql.ErrNoRows:
		stored = 0
	default:
		return err
	}
	if stored >= parserVersion {
		return nil
	}

	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `delete from source_files`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from session_agents`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `update sessions set need_sync = 1, synced_at = null`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		insert into meta (key, value) values ('parser_version', ?)
		on conflict(key) do update set value = excluded.value
	`, strconv.Itoa(parserVersion)); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *Store) dropRemovedTokenColumns(ctx context.Context) error {
	for _, table := range []string{"sessions", "usage_calls"} {
		for _, column := range []string{"reasoning_tokens", "total_tokens"} {
			hasColumn, err := store.tableHasColumn(ctx, table, column)
			if err != nil {
				return err
			}
			if !hasColumn {
				continue
			}
			if _, err := store.db.ExecContext(ctx, `alter table `+table+` drop column `+column); err != nil {
				return err
			}
		}
	}
	return nil
}

func (store *Store) tableHasColumn(ctx context.Context, table string, column string) (bool, error) {
	rows, err := store.db.QueryContext(ctx, `pragma table_info(`+table+`)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return false, nil
}

func (store *Store) ensureSessionSyncColumns(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, `pragma table_info(sessions)`)
	if err != nil {
		return err
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if !columns["need_sync"] {
		if _, err := store.db.ExecContext(ctx, `alter table sessions add column need_sync integer not null default 1`); err != nil {
			return err
		}
	}
	if !columns["synced_at"] {
		if _, err := store.db.ExecContext(ctx, `alter table sessions add column synced_at text`); err != nil {
			return err
		}
	}
	return nil
}

// ensureSourceFileLinkageColumns adds the raw thread-id columns used to resolve
// Codex subagent files (separate session ids) up to their root parent. They are
// empty for older rows until re-parsed (the parserVersion bump forces that).
func (store *Store) ensureSourceFileLinkageColumns(ctx context.Context) error {
	for _, column := range []string{"own_session_id", "parent_session_id"} {
		hasColumn, err := store.tableHasColumn(ctx, "source_files", column)
		if err != nil {
			return err
		}
		if hasColumn {
			continue
		}
		if _, err := store.db.ExecContext(ctx, `alter table source_files add column `+column+` text not null default ''`); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) normalizeTimestamps(ctx context.Context) error {
	if err := store.normalizeSessionTimestamps(ctx); err != nil {
		return err
	}
	if err := store.normalizeSourceFileTimestamps(ctx); err != nil {
		return err
	}
	if err := store.normalizeUsageCallTimestamps(ctx); err != nil {
		return err
	}
	return store.normalizeLocalDeviceTimestamps(ctx)
}

func (store *Store) normalizeSessionTimestamps(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, `select session_hash, started_at, ended_at, updated_at, synced_at from sessions`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type sessionTimestamps struct {
		hash      string
		startedAt string
		endedAt   string
		updatedAt string
		syncedAt  sql.NullString
	}
	var updates []sessionTimestamps
	for rows.Next() {
		var current sessionTimestamps
		if err := rows.Scan(&current.hash, &current.startedAt, &current.endedAt, &current.updatedAt, &current.syncedAt); err != nil {
			return err
		}
		normalizedSyncedAt := current.syncedAt
		if normalizedSyncedAt.Valid {
			normalizedSyncedAt.String = normalizeTimestamp(normalizedSyncedAt.String)
		}
		normalized := sessionTimestamps{
			hash:      current.hash,
			startedAt: normalizeTimestamp(current.startedAt),
			endedAt:   normalizeTimestamp(current.endedAt),
			updatedAt: normalizeTimestamp(current.updatedAt),
			syncedAt:  normalizedSyncedAt,
		}
		if normalized.startedAt != current.startedAt || normalized.endedAt != current.endedAt || normalized.updatedAt != current.updatedAt || normalized.syncedAt != current.syncedAt {
			updates = append(updates, normalized)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, update := range updates {
		if _, err := store.db.ExecContext(ctx, `
			update sessions
			set started_at = ?, ended_at = ?, updated_at = ?, synced_at = ?
			where session_hash = ?
		`, update.startedAt, update.endedAt, update.updatedAt, update.syncedAt, update.hash); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) normalizeSourceFileTimestamps(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, `select file_key, modified_at, last_parsed_at from source_files`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type sourceFileTimestamps struct {
		key          string
		modifiedAt   string
		lastParsedAt string
	}
	var updates []sourceFileTimestamps
	for rows.Next() {
		var current sourceFileTimestamps
		if err := rows.Scan(&current.key, &current.modifiedAt, &current.lastParsedAt); err != nil {
			return err
		}
		normalized := sourceFileTimestamps{
			key:          current.key,
			modifiedAt:   normalizeTimestamp(current.modifiedAt),
			lastParsedAt: normalizeTimestamp(current.lastParsedAt),
		}
		if normalized.modifiedAt != current.modifiedAt || normalized.lastParsedAt != current.lastParsedAt {
			updates = append(updates, normalized)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, update := range updates {
		if _, err := store.db.ExecContext(ctx, `
			update source_files
			set modified_at = ?, last_parsed_at = ?
			where file_key = ?
		`, update.modifiedAt, update.lastParsedAt, update.key); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) normalizeUsageCallTimestamps(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, `select provider, session_hash, call_key, occurred_at, updated_at from usage_calls`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type usageCallTimestamps struct {
		provider   string
		session    string
		key        string
		occurredAt string
		updatedAt  string
	}
	var updates []usageCallTimestamps
	for rows.Next() {
		var current usageCallTimestamps
		if err := rows.Scan(&current.provider, &current.session, &current.key, &current.occurredAt, &current.updatedAt); err != nil {
			return err
		}
		normalized := usageCallTimestamps{
			provider:   current.provider,
			session:    current.session,
			key:        current.key,
			occurredAt: normalizeTimestamp(current.occurredAt),
			updatedAt:  normalizeTimestamp(current.updatedAt),
		}
		if normalized.occurredAt != current.occurredAt || normalized.updatedAt != current.updatedAt {
			updates = append(updates, normalized)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, update := range updates {
		if _, err := store.db.ExecContext(ctx, `
			update usage_calls
			set occurred_at = ?, updated_at = ?
			where provider = ? and session_hash = ? and call_key = ?
		`, update.occurredAt, update.updatedAt, update.provider, update.session, update.key); err != nil {
			return err
		}
	}
	return nil
}

func (store *Store) normalizeLocalDeviceTimestamps(ctx context.Context) error {
	rows, err := store.db.QueryContext(ctx, `select device_id, created_at, updated_at from local_device`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type deviceTimestamps struct {
		id        string
		createdAt string
		updatedAt string
	}
	var updates []deviceTimestamps
	for rows.Next() {
		var current deviceTimestamps
		if err := rows.Scan(&current.id, &current.createdAt, &current.updatedAt); err != nil {
			return err
		}
		normalized := deviceTimestamps{
			id:        current.id,
			createdAt: normalizeTimestamp(current.createdAt),
			updatedAt: normalizeTimestamp(current.updatedAt),
		}
		if normalized.createdAt != current.createdAt || normalized.updatedAt != current.updatedAt {
			updates = append(updates, normalized)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, update := range updates {
		if _, err := store.db.ExecContext(ctx, `
			update local_device
			set created_at = ?, updated_at = ?
			where device_id = ?
		`, update.createdAt, update.updatedAt, update.id); err != nil {
			return err
		}
	}
	return nil
}

func normalizeTimestamp(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	return parsed.In(kst).Format(time.RFC3339Nano)
}

func nullableString(value string) sql.NullString {
	return sql.NullString{
		String: value,
		Valid:  value != "",
	}
}

func defaultDeviceLabel() string {
	hostname, err := os.Hostname()
	if err != nil {
		return "unknown-device"
	}
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		return "unknown-device"
	}
	return hostname
}

func newUUIDV4() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80

	encoded := make([]byte, 32)
	hex.Encode(encoded, bytes[:])
	return string(encoded[0:8]) + "-" +
		string(encoded[8:12]) + "-" +
		string(encoded[12:16]) + "-" +
		string(encoded[16:20]) + "-" +
		string(encoded[20:32]), nil
}
