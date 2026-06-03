package state

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
	_ "modernc.org/sqlite"
)

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

	deviceID, err := newUUIDV4()
	if err != nil {
		return LocalDevice{}, err
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
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, null)
		on conflict(session_hash) do update set
			provider = excluded.provider,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			user_turn_count = excluded.user_turn_count,
			llm_call_count = excluded.llm_call_count,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_tokens = excluded.cache_tokens,
			updated_at = excluded.updated_at,
			need_sync = 1,
			synced_at = null
	`, parsed.Summary.SessionHash, provider, parsed.Summary.StartedAt, parsed.Summary.EndedAt, parsed.Summary.UserTurnCount, parsed.Summary.LLMCallCount, parsed.Summary.Tokens.Input, parsed.Summary.Tokens.Output, parsed.Summary.Tokens.Cache, now); err != nil {
		return err
	}

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
			last_parsed_at
		) values (?, ?, ?, ?, ?, ?)
		on conflict(file_key) do update set
			provider = excluded.provider,
			size_bytes = excluded.size_bytes,
			modified_at = excluded.modified_at,
			session_hash = excluded.session_hash,
			last_parsed_at = excluded.last_parsed_at
	`, fileKey, provider, sizeBytes, modifiedAt, parsed.Summary.SessionHash, now); err != nil {
		return err
	}

	return tx.Commit()
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

		create table if not exists local_device (
			device_id text primary key,
			device_label text not null,
			platform text not null,
			created_at text not null,
			updated_at text not null
		);

		create index if not exists idx_sessions_provider_started_at on sessions(provider, started_at);
		create index if not exists idx_source_files_provider_modified_at on source_files(provider, modified_at);
		create index if not exists idx_usage_calls_session on usage_calls(provider, session_hash, call_index);
		create index if not exists idx_usage_calls_source_file on usage_calls(provider, source_file_key);
	`)
	if err != nil {
		return err
	}
	if err := store.ensureSessionSyncColumns(ctx); err != nil {
		return err
	}
	if err := store.dropRemovedTokenColumns(ctx); err != nil {
		return err
	}
	_, err = store.db.ExecContext(ctx, `
		create index if not exists idx_sessions_need_sync on sessions(need_sync, provider, started_at);
	`)
	return err
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
