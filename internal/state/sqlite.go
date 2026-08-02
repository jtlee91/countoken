package state

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"sort"
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
//
// v7: Codex session files can contain nested/forked session_meta records after
// the file's own first session_meta; keep the first meta as the file identity.
//
// v8: Claude twin sessions — a resumed session or a background ("bg") mirror is
// written as a new file with a new sessionId but re-contains the whole
// transcript, so it was double-counted as a separate session. Twin files share
// the conversation's first message uuid (root_uuid) and are now folded onto one
// session_hash; Claude call keys are message-identity based (not session scoped)
// so the shared calls dedupe on merge.
//
// v11: sessions and agents carry the dominant billing speed, so a fast-mode
// session prices at the fast rate. Fast mode is a third of Codex tokens and
// costs 2-2.5x, which is far too large to round away; the approximation of one
// speed per row misprices only the minority side of a mixed row, about 1% of
// tokens locally.
//
// v10: cost buckets — cache writes are split by TTL (Claude) and carved out of
// the uncached input (Codex), the billing speed is recorded, and Codex calls
// carry the model read from turn_context. The legacy input/output/cache columns
// keep their exact values; the new columns decompose them.
//
// v9: Codex fork replay — a child rollout can prepend copied parent history with
// rewritten record timestamps. Only events after the child's own UUIDv7 turn
// boundary are counted, and repeated cumulative token snapshots are normalized
// before calls are emitted.
const parserVersion = 11

// ParserVersion exposes the current parsing-logic version so the CLI can report
// it to the sync server (per-device), making a rollout's reach observable.
const ParserVersion = parserVersion

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
	Model      string
	ModelCount int
	Speed      string
	Provider   string
	UpdatedAt  string
	usage.SessionSummary
}

type UsageCallRow struct {
	Provider    string
	SessionHash string
	UpdatedAt   string
	usage.UsageCall
}

type DailyUsageRow struct {
	UsageDate          string
	Provider           string
	Model              string
	SessionCount       int
	LLMCallCount       int
	InputTokens        int
	OutputTokens       int
	CacheTokens        int
	InputRawTokens     int
	CacheWrite5mTokens int
	CacheWrite1hTokens int
	FirstUsedAt        string
	LastUsedAt         string
	LocalUpdatedAt     string
}

type SessionAgentRow struct {
	Model              string
	Speed              string
	Provider           string
	SessionHash        string
	AgentKey           string
	ParentAgentKey     string
	Depth              int
	LabelType          string
	LabelText          string
	InputTokens        int
	OutputTokens       int
	CacheTokens        int
	InputRawTokens     int
	CacheWrite5mTokens int
	CacheWrite1hTokens int
	LLMCallCount       int
	UserTurnCount      int
	StartedAt          string
	EndedAt            string
	UpdatedAt          string
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
			sa.input_raw_tokens,
			sa.cache_write_5m_tokens,
			sa.cache_write_1h_tokens,
			sa.model,
			sa.speed,
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
			&agent.InputRawTokens,
			&agent.CacheWrite5mTokens,
			&agent.CacheWrite1hTokens,
			&agent.Model,
			&agent.Speed,
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
			coalesce(sum(uc.input_raw_tokens), 0) as input_raw_tokens,
			coalesce(sum(uc.cache_write_5m_tokens), 0) as cache_write_5m_tokens,
			coalesce(sum(uc.cache_write_1h_tokens), 0) as cache_write_1h_tokens,
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
			&row.InputRawTokens,
			&row.CacheWrite5mTokens,
			&row.CacheWrite1hTokens,
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
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			model,
			model_count,
			speed,
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
			&session.Tokens.InputRaw,
			&session.Tokens.CacheWrite5m,
			&session.Tokens.CacheWrite1h,
			&session.Model,
			&session.ModelCount,
			&session.Speed,
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
			s.cache_tokens,
			s.input_raw_tokens,
			s.cache_write_5m_tokens,
			s.cache_write_1h_tokens
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
		&session.Tokens.InputRaw,
		&session.Tokens.CacheWrite5m,
		&session.Tokens.CacheWrite1h,
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
				speed,
				input_tokens,
				output_tokens,
				cache_tokens,
				input_raw_tokens,
				cache_write_5m_tokens,
				cache_write_1h_tokens,
				source_file_key,
				updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			on conflict(provider, session_hash, call_key) do update set
				call_index = excluded.call_index,
				occurred_at = excluded.occurred_at,
				model = excluded.model,
				speed = excluded.speed,
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cache_tokens = excluded.cache_tokens,
				input_raw_tokens = excluded.input_raw_tokens,
				cache_write_5m_tokens = excluded.cache_write_5m_tokens,
				cache_write_1h_tokens = excluded.cache_write_1h_tokens,
				source_file_key = excluded.source_file_key,
				updated_at = excluded.updated_at
		`, provider, parsed.Summary.SessionHash, call.CallKey, call.CallIndex, call.OccurredAt,
			nullableString(call.Model), normalizedSpeed(call.Speed),
			call.Tokens.Input, call.Tokens.Output, call.Tokens.Cache,
			call.Tokens.InputRaw, call.Tokens.CacheWrite5m, call.Tokens.CacheWrite1h,
			fileKey, now); err != nil {
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
			parent_session_id,
			root_uuid
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
		on conflict(file_key) do update set
			provider = excluded.provider,
			size_bytes = excluded.size_bytes,
			modified_at = excluded.modified_at,
			session_hash = excluded.session_hash,
			last_parsed_at = excluded.last_parsed_at,
			own_session_id = excluded.own_session_id,
			parent_session_id = excluded.parent_session_id,
			root_uuid = excluded.root_uuid
	`, fileKey, provider, sizeBytes, modifiedAt, parsed.Summary.SessionHash, now, parsed.OwnSessionID, parsed.ParentSessionID, parsed.RootUUID); err != nil {
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
	// The dominant model drives the list chip; model_count tells the UI whether to
	// render a "+N". Dominance is by token volume because rates live server-side.
	sessionModel, sessionModelCount, err := dominantModel(ctx, tx,
		`provider = ? and session_hash = ?`, provider, parsed.Summary.SessionHash)
	if err != nil {
		return err
	}
	sessionSpeed, err := dominantSpeed(ctx, tx,
		`provider = ? and session_hash = ?`, provider, parsed.Summary.SessionHash)
	if err != nil {
		return err
	}

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
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			model,
			model_count,
			speed,
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
			coalesce(sum(input_raw_tokens), 0),
			coalesce(sum(cache_write_5m_tokens), 0),
			coalesce(sum(cache_write_1h_tokens), 0),
			?,
			?,
			?,
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
			input_raw_tokens = excluded.input_raw_tokens,
			cache_write_5m_tokens = excluded.cache_write_5m_tokens,
			cache_write_1h_tokens = excluded.cache_write_1h_tokens,
			model = excluded.model,
			model_count = excluded.model_count,
			speed = excluded.speed,
			updated_at = excluded.updated_at,
			need_sync = 1,
			synced_at = null
	`, parsed.Summary.SessionHash, provider,
		parsed.Summary.StartedAt, parsed.Summary.EndedAt,
		parsed.Summary.UserTurnCount,
		parsed.Summary.LLMCallCount,
		parsed.Summary.Tokens.Input, parsed.Summary.Tokens.Output, parsed.Summary.Tokens.Cache,
		sessionModel, sessionModelCount, sessionSpeed,
		now, provider, parsed.Summary.SessionHash); err != nil {
		return err
	}

	// Record this file's contribution as one "agent" (the main turn or one
	// subagent) under the session. Token/call/time come from this file's
	// usage_calls; identity/label from the parser. The label is upserted only when
	// non-empty so Claude's split sources (subagent file = tokens, main file =
	// label) don't clobber each other regardless of parse order.
	if agentKey := parsed.Agent.AgentKey; agentKey != "" {
		// An agent lives in one source file, so its calls are almost always a single
		// model; the web groups agent rows by model to get a session breakdown.
		agentModel, _, err := dominantModel(ctx, tx, `provider = ? and source_file_key = ?`, provider, fileKey)
		if err != nil {
			return err
		}
		agentSpeed, err := dominantSpeed(ctx, tx, `provider = ? and source_file_key = ?`, provider, fileKey)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			insert into session_agents (
				provider, session_hash, agent_key, parent_agent_key, depth,
				label_type, label_text,
				input_tokens, output_tokens, cache_tokens,
				input_raw_tokens, cache_write_5m_tokens, cache_write_1h_tokens, model, speed,
				llm_call_count, user_turn_count,
				started_at, ended_at, source_file_key, updated_at
			)
			select
				?, ?, ?, ?, ?,
				?, ?,
				coalesce(sum(input_tokens), 0), coalesce(sum(output_tokens), 0), coalesce(sum(cache_tokens), 0),
				coalesce(sum(input_raw_tokens), 0), coalesce(sum(cache_write_5m_tokens), 0),
				coalesce(sum(cache_write_1h_tokens), 0), ?, ?,
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
				input_raw_tokens = excluded.input_raw_tokens,
				cache_write_5m_tokens = excluded.cache_write_5m_tokens,
				cache_write_1h_tokens = excluded.cache_write_1h_tokens,
				model = excluded.model,
				speed = excluded.speed,
				llm_call_count = excluded.llm_call_count,
				user_turn_count = excluded.user_turn_count,
				started_at = excluded.started_at,
				ended_at = excluded.ended_at,
				source_file_key = excluded.source_file_key,
				updated_at = excluded.updated_at
		`, provider, parsed.Summary.SessionHash, agentKey, parsed.Agent.ParentKey, parsed.Agent.Depth,
			parsed.Agent.LabelType, parsed.Agent.LabelText, agentModel, agentSpeed,
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
		select own_session_id, parent_session_id, session_hash
		from source_files
		where provider = ? and own_session_id != ''
	`, provider)
	if err != nil {
		return err
	}
	parent := map[string]string{}
	currentHash := map[string]string{}
	var owns []string
	for rows.Next() {
		var own, par, hash string
		if err := rows.Scan(&own, &par, &hash); err != nil {
			rows.Close()
			return err
		}
		if _, seen := parent[own]; !seen {
			owns = append(owns, own)
		}
		parent[own] = strings.TrimSpace(par)
		currentHash[own] = hash
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	type remap struct{ oldHash, newHash string }
	var remaps []remap
	affectedRoots := map[string]struct{}{}
	for _, own := range owns {
		root := resolveRoot(own, parent)
		if root != own {
			newHash := usage.HashSessionID(provider, root)
			oldHash := currentHash[own]
			if oldHash == "" {
				oldHash = usage.HashSessionID(provider, own)
			}
			if oldHash == newHash {
				continue
			}
			remaps = append(remaps, remap{
				oldHash: oldHash,
				newHash: newHash,
			})
			affectedRoots[newHash] = struct{}{}
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
		if err := mergeUsageCallsIntoSession(ctx, tx, provider, r.oldHash, r.newHash); err != nil {
			return err
		}
		if err := mergeSessionAgentsIntoSession(ctx, tx, provider, r.oldHash, r.newHash); err != nil {
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
	for rootHash := range affectedRoots {
		// Rolling a subagent's calls up changed the session's call set, so its
		// dominant model has to be recomputed from the merged rows rather than
		// left at whatever the root file alone reported.
		rootModel, rootModelCount, err := dominantModel(ctx, tx,
			`provider = ? and session_hash = ?`, provider, rootHash)
		if err != nil {
			return err
		}
		rootSpeed, err := dominantSpeed(ctx, tx,
			`provider = ? and session_hash = ?`, provider, rootHash)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			update sessions set
				input_tokens = (select coalesce(sum(input_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				output_tokens = (select coalesce(sum(output_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_tokens = (select coalesce(sum(cache_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				input_raw_tokens = (select coalesce(sum(input_raw_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_write_5m_tokens = (select coalesce(sum(cache_write_5m_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_write_1h_tokens = (select coalesce(sum(cache_write_1h_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				model = ?,
				model_count = ?,
				speed = ?,
				llm_call_count = (select count(*) from usage_calls where provider = ? and session_hash = ?),
				started_at = coalesce((select min(occurred_at) from usage_calls where provider = ? and session_hash = ?), started_at),
				ended_at = coalesce((select max(occurred_at) from usage_calls where provider = ? and session_hash = ?), ended_at),
				updated_at = ?, need_sync = 1, synced_at = null
			where provider = ? and session_hash = ?
		`, provider, rootHash, provider, rootHash, provider, rootHash,
			provider, rootHash, provider, rootHash, provider, rootHash,
			rootModel, rootModelCount, rootSpeed,
			provider, rootHash, provider, rootHash, provider, rootHash,
			now, provider, rootHash); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func mergeUsageCallsIntoSession(ctx context.Context, tx *sql.Tx, provider string, oldHash string, newHash string) error {
	if _, err := tx.ExecContext(ctx, `
		insert into usage_calls (
			provider,
			session_hash,
			call_key,
			call_index,
			occurred_at,
			model,
			speed,
			input_tokens,
			output_tokens,
			cache_tokens,
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			source_file_key,
			updated_at
		)
		select
			provider,
			?,
			call_key,
			call_index,
			occurred_at,
			model,
			speed,
			input_tokens,
			output_tokens,
			cache_tokens,
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			source_file_key,
			updated_at
		from usage_calls
		where provider = ? and session_hash = ?
		on conflict(provider, session_hash, call_key) do update set
			call_index = excluded.call_index,
			occurred_at = excluded.occurred_at,
			model = excluded.model,
			speed = excluded.speed,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_tokens = excluded.cache_tokens,
			input_raw_tokens = excluded.input_raw_tokens,
			cache_write_5m_tokens = excluded.cache_write_5m_tokens,
			cache_write_1h_tokens = excluded.cache_write_1h_tokens,
			source_file_key = excluded.source_file_key,
			updated_at = excluded.updated_at
	`, newHash, provider, oldHash); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		delete from usage_calls
		where provider = ? and session_hash = ?
	`, provider, oldHash)
	return err
}

func mergeSessionAgentsIntoSession(ctx context.Context, tx *sql.Tx, provider string, oldHash string, newHash string) error {
	if _, err := tx.ExecContext(ctx, `
		insert into session_agents (
			provider,
			session_hash,
			agent_key,
			parent_agent_key,
			depth,
			label_type,
			label_text,
			input_tokens,
			output_tokens,
			cache_tokens,
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			model,
			speed,
			llm_call_count,
			user_turn_count,
			started_at,
			ended_at,
			source_file_key,
			updated_at
		)
		select
			provider,
			?,
			agent_key,
			parent_agent_key,
			depth,
			label_type,
			label_text,
			input_tokens,
			output_tokens,
			cache_tokens,
			input_raw_tokens,
			cache_write_5m_tokens,
			cache_write_1h_tokens,
			model,
			speed,
			llm_call_count,
			user_turn_count,
			started_at,
			ended_at,
			source_file_key,
			updated_at
		from session_agents
		where provider = ? and session_hash = ?
		on conflict(provider, session_hash, agent_key) do update set
			parent_agent_key = case when excluded.parent_agent_key != '' then excluded.parent_agent_key else session_agents.parent_agent_key end,
			depth = case when excluded.depth != 0 then excluded.depth else session_agents.depth end,
			label_type = case when excluded.label_type != '' then excluded.label_type else session_agents.label_type end,
			label_text = case when excluded.label_text != '' then excluded.label_text else session_agents.label_text end,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_tokens = excluded.cache_tokens,
			input_raw_tokens = excluded.input_raw_tokens,
			cache_write_5m_tokens = excluded.cache_write_5m_tokens,
			cache_write_1h_tokens = excluded.cache_write_1h_tokens,
			model = case when excluded.model != '' then excluded.model else session_agents.model end,
			speed = excluded.speed,
			llm_call_count = excluded.llm_call_count,
			user_turn_count = excluded.user_turn_count,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			source_file_key = excluded.source_file_key,
			updated_at = excluded.updated_at
	`, newHash, provider, oldHash); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		delete from session_agents
		where provider = ? and session_hash = ?
	`, provider, oldHash)
	return err
}

// ResolveClaudeTwins folds Claude sessions that are the same conversation split
// across multiple session files onto one session_hash. When a session is resumed
// or mirrored to a background ("bg") session, Claude writes a new file with a new
// sessionId that re-contains the whole transcript, which otherwise shows up as a
// duplicate session with near-identical totals. Twin files share the
// conversation's first message uuid (root_uuid); files in the same group are
// merged onto the lexicographically smallest session_hash, and the shared LLM
// calls dedupe because Claude call keys are message-identity based, not session
// scoped. No-op for files without a root_uuid (subagent files, which are already
// attached to their parent via a shared sessionId) and for other providers.
func (store *Store) ResolveClaudeTwins(ctx context.Context) error {
	const provider = "claude"
	rows, err := store.db.QueryContext(ctx, `
		select distinct root_uuid, session_hash
		from source_files
		where provider = ? and root_uuid != ''
	`, provider)
	if err != nil {
		return err
	}
	hashesByRoot := map[string][]string{}
	seen := map[string]map[string]struct{}{}
	for rows.Next() {
		var root, hash string
		if err := rows.Scan(&root, &hash); err != nil {
			rows.Close()
			return err
		}
		if seen[root] == nil {
			seen[root] = map[string]struct{}{}
		}
		if _, ok := seen[root][hash]; ok {
			continue
		}
		seen[root][hash] = struct{}{}
		hashesByRoot[root] = append(hashesByRoot[root], hash)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	type remap struct{ oldHash, newHash string }
	var remaps []remap
	canonical := map[string]struct{}{}
	for _, hashes := range hashesByRoot {
		if len(hashes) < 2 {
			continue
		}
		sort.Strings(hashes)
		root := hashes[0]
		canonical[root] = struct{}{}
		for _, h := range hashes[1:] {
			remaps = append(remaps, remap{oldHash: h, newHash: root})
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
		// Carry the human-turn count forward before the source session is dropped;
		// it can't be recomputed from usage_calls, and twins share the same turns.
		if _, err := tx.ExecContext(ctx, `
			update sessions set user_turn_count = max(
				user_turn_count,
				coalesce((select user_turn_count from sessions where session_hash = ?), 0)
			)
			where session_hash = ?
		`, r.oldHash, r.newHash); err != nil {
			return err
		}
		if err := mergeUsageCallsIntoSession(ctx, tx, provider, r.oldHash, r.newHash); err != nil {
			return err
		}
		if err := mergeSessionAgentsIntoSession(ctx, tx, provider, r.oldHash, r.newHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `update source_files set session_hash = ? where provider = ? and session_hash = ?`, r.newHash, provider, r.oldHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `delete from sessions where provider = ? and session_hash = ?`, provider, r.oldHash); err != nil {
			return err
		}
	}

	// Recompute each merged session's totals from the deduped usage_calls, and
	// rebuild its main agent row as the session total minus its subagents so the
	// expandable breakdown still sums to the header.
	for rootHash := range canonical {
		// The merge changed which calls belong to this session, so the dominant
		// model has to be recomputed from the merged set rather than kept from
		// whichever file happened to be parsed last.
		rootModel, rootModelCount, err := dominantModel(ctx, tx,
			`provider = ? and session_hash = ?`, provider, rootHash)
		if err != nil {
			return err
		}
		rootSpeed, err := dominantSpeed(ctx, tx,
			`provider = ? and session_hash = ?`, provider, rootHash)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			update sessions set
				input_tokens = (select coalesce(sum(input_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				output_tokens = (select coalesce(sum(output_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_tokens = (select coalesce(sum(cache_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				input_raw_tokens = (select coalesce(sum(input_raw_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_write_5m_tokens = (select coalesce(sum(cache_write_5m_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				cache_write_1h_tokens = (select coalesce(sum(cache_write_1h_tokens), 0) from usage_calls where provider = ? and session_hash = ?),
				model = ?,
				model_count = ?,
				speed = ?,
				llm_call_count = (select count(*) from usage_calls where provider = ? and session_hash = ?),
				started_at = coalesce((select min(occurred_at) from usage_calls where provider = ? and session_hash = ?), started_at),
				ended_at = coalesce((select max(occurred_at) from usage_calls where provider = ? and session_hash = ?), ended_at),
				updated_at = ?, need_sync = 1, synced_at = null
			where provider = ? and session_hash = ?
		`, provider, rootHash, provider, rootHash, provider, rootHash,
			provider, rootHash, provider, rootHash, provider, rootHash,
			rootModel, rootModelCount, rootSpeed,
			provider, rootHash, provider, rootHash, provider, rootHash,
			now, provider, rootHash); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			update session_agents set
				input_tokens = max(0, (select input_tokens from sessions where session_hash = ?) - coalesce((select sum(input_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				output_tokens = max(0, (select output_tokens from sessions where session_hash = ?) - coalesce((select sum(output_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				cache_tokens = max(0, (select cache_tokens from sessions where session_hash = ?) - coalesce((select sum(cache_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				input_raw_tokens = max(0, (select input_raw_tokens from sessions where session_hash = ?) - coalesce((select sum(input_raw_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				cache_write_5m_tokens = max(0, (select cache_write_5m_tokens from sessions where session_hash = ?) - coalesce((select sum(cache_write_5m_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				cache_write_1h_tokens = max(0, (select cache_write_1h_tokens from sessions where session_hash = ?) - coalesce((select sum(cache_write_1h_tokens) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				llm_call_count = max(0, (select llm_call_count from sessions where session_hash = ?) - coalesce((select sum(llm_call_count) from session_agents where provider = ? and session_hash = ? and agent_key != 'main'), 0)),
				updated_at = ?
			where provider = ? and session_hash = ? and agent_key = 'main'
		`, rootHash, provider, rootHash, rootHash, provider, rootHash, rootHash, provider, rootHash,
			rootHash, provider, rootHash, rootHash, provider, rootHash, rootHash, provider, rootHash,
			rootHash, provider, rootHash, now, provider, rootHash); err != nil {
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
			input_raw_tokens integer not null default 0,
			cache_write_5m_tokens integer not null default 0,
			cache_write_1h_tokens integer not null default 0,
			model text not null default '',
			model_count integer not null default 0,
			speed text not null default 'standard',
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
			speed text not null default 'standard',
			input_tokens integer not null,
			output_tokens integer not null,
			cache_tokens integer not null,
			input_raw_tokens integer not null default 0,
			cache_write_5m_tokens integer not null default 0,
			cache_write_1h_tokens integer not null default 0,
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
			input_raw_tokens integer not null default 0,
			cache_write_5m_tokens integer not null default 0,
			cache_write_1h_tokens integer not null default 0,
			model text not null default '',
			speed text not null default 'standard',
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
	if err := store.ensureCostBucketColumns(ctx); err != nil {
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

// ensureCostBucketColumns adds the finer buckets a rate lookup needs. The legacy
// input/output/cache columns keep their meaning; the new ones decompose input
// into raw input plus cache writes split by TTL, and record the billing speed
// and the session's dominant model. Existing rows default to zero/empty until
// the parserVersion bump forces a re-parse.
func (store *Store) ensureCostBucketColumns(ctx context.Context) error {
	intColumns := []string{"input_raw_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens"}
	for _, table := range []string{"usage_calls", "sessions", "session_agents"} {
		for _, column := range intColumns {
			if err := store.addColumnIfMissing(ctx, table, column, "integer not null default 0"); err != nil {
				return err
			}
		}
	}
	for _, table := range []string{"usage_calls", "sessions", "session_agents"} {
		if err := store.addColumnIfMissing(ctx, table, "speed", "text not null default 'standard'"); err != nil {
			return err
		}
	}
	for _, table := range []string{"sessions", "session_agents"} {
		if err := store.addColumnIfMissing(ctx, table, "model", "text not null default ''"); err != nil {
			return err
		}
	}
	if err := store.addColumnIfMissing(ctx, "sessions", "model_count", "integer not null default 0"); err != nil {
		return err
	}
	return store.backfillCostColumns(ctx)
}

// backfillCostColumns fills the new columns for rows the parser can no longer
// reach. The parserVersion bump re-parses every transcript still on disk, but the
// agents prune their own transcripts, so rows whose file is gone would keep the
// column defaults forever — a $0 input cost on a row whose input_tokens says
// otherwise, and a session with no model chip.
//
// Buckets: attributing the whole legacy total to raw input restores the invariant
//
//	input_tokens = input_raw_tokens + cache_write_5m_tokens + cache_write_1h_tokens
//
// for every row, so read-side costing needs no special case. Raw is the cheapest
// of the three, so the estimate can only undercount, never inflate a bill.
//
// Models: usage_calls keeps its per-call model even when the file is gone, so a
// stale session or agent can recover its chip from its own calls. The ranking
// matches dominantModel — most tokens first, name as tie-break.
//
// Everything here is idempotent and matches nothing once a device has settled;
// rows whose file is still on disk are overwritten by the re-parse that follows.
func (store *Store) backfillCostColumns(ctx context.Context) error {
	for _, table := range []string{"usage_calls", "sessions", "session_agents"} {
		if _, err := store.db.ExecContext(ctx, `
			update `+table+` set input_raw_tokens = input_tokens
			where input_tokens > 0
			  and input_raw_tokens = 0
			  and cache_write_5m_tokens = 0
			  and cache_write_1h_tokens = 0
		`); err != nil {
			return err
		}
	}

	if _, err := store.db.ExecContext(ctx, `
		update sessions set
			model = coalesce((
				select model from usage_calls
				where provider = sessions.provider and session_hash = sessions.session_hash
				  and model is not null and model != ''
				group by model
				order by sum(input_tokens + output_tokens + cache_tokens) desc, model
				limit 1
			), ''),
			model_count = (
				select count(distinct model) from usage_calls
				where provider = sessions.provider and session_hash = sessions.session_hash
				  and model is not null and model != ''
			),
			speed = coalesce((
				select speed from usage_calls
				where provider = sessions.provider and session_hash = sessions.session_hash
				  and speed is not null and speed != ''
				group by speed
				order by sum(input_tokens + output_tokens + cache_tokens) desc, speed
				limit 1
			), 'standard')
		where model = ''
	`); err != nil {
		return err
	}

	// An agent is scoped to one source file rather than to the session, since a
	// session's files can each run a different model.
	_, err := store.db.ExecContext(ctx, `
		update session_agents set
			model = coalesce((
				select model from usage_calls
				where provider = session_agents.provider
				  and source_file_key = session_agents.source_file_key
				  and model is not null and model != ''
				group by model
				order by sum(input_tokens + output_tokens + cache_tokens) desc, model
				limit 1
			), ''),
			speed = coalesce((
				select speed from usage_calls
				where provider = session_agents.provider
				  and source_file_key = session_agents.source_file_key
				  and speed is not null and speed != ''
				group by speed
				order by sum(input_tokens + output_tokens + cache_tokens) desc, speed
				limit 1
			), 'standard')
		where model = '' and source_file_key != ''
	`)
	return err
}

func (store *Store) addColumnIfMissing(ctx context.Context, table, column, definition string) error {
	hasColumn, err := store.tableHasColumn(ctx, table, column)
	if err != nil {
		return err
	}
	if hasColumn {
		return nil
	}
	_, err = store.db.ExecContext(ctx, `alter table `+table+` add column `+column+` `+definition)
	return err
}

// ensureSourceFileLinkageColumns adds the raw thread-id columns used to resolve
// Codex subagent files (separate session ids) up to their root parent. They are
// empty for older rows until re-parsed (the parserVersion bump forces that).
func (store *Store) ensureSourceFileLinkageColumns(ctx context.Context) error {
	for _, column := range []string{"own_session_id", "parent_session_id", "root_uuid"} {
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

// normalizedSpeed keeps the stored value inside the known vocabulary so a rate
// lookup never misses on an unexpected string.
// dominantModel returns the model that consumed the most tokens under the given
// usage_calls filter, plus how many distinct models appeared. Rates live
// server-side, so volume is the local proxy for "which model defines this row".
func dominantModel(ctx context.Context, tx *sql.Tx, where string, args ...any) (string, int, error) {
	var model sql.NullString
	err := tx.QueryRowContext(ctx, `
		select model from usage_calls
		where `+where+` and model is not null and model != ''
		group by model
		order by sum(input_tokens + output_tokens + cache_tokens) desc, model
		limit 1
	`, args...).Scan(&model)
	switch err {
	case nil, sql.ErrNoRows:
	default:
		return "", 0, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, `
		select count(distinct model) from usage_calls
		where `+where+` and model is not null and model != ''
	`, args...).Scan(&count); err != nil {
		return "", 0, err
	}
	return model.String, count, nil
}

// dominantSpeed returns the billing speed that consumed the most tokens under
// the given scope. A row can only carry one speed, and standard/fast differ by
// 2x or more, so the majority side is the least-wrong single answer for a
// session or agent that toggled mid-run.
func dominantSpeed(ctx context.Context, tx *sql.Tx, where string, args ...any) (string, error) {
	var speed sql.NullString
	err := tx.QueryRowContext(ctx, `
		select speed from usage_calls
		where `+where+` and speed is not null and speed != ''
		group by speed
		order by sum(input_tokens + output_tokens + cache_tokens) desc, speed
		limit 1
	`, args...).Scan(&speed)
	switch err {
	case nil, sql.ErrNoRows:
	default:
		return "", err
	}
	return normalizedSpeed(speed.String), nil
}

func normalizedSpeed(value string) string {
	if value == usage.SpeedFast {
		return usage.SpeedFast
	}
	return usage.SpeedStandard
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
