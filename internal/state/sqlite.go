package state

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

var kst = time.FixedZone("KST", 9*60*60)

type SourceFile struct {
	SizeBytes  int64
	ModifiedAt string
	Session    usage.SessionSummary
}

type SessionRow struct {
	Provider  string
	UpdatedAt string
	usage.SessionSummary
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
			reasoning_tokens,
			total_tokens,
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
			&session.Tokens.Reasoning,
			&session.Tokens.Total,
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
			s.session_hash,
			s.started_at,
			s.ended_at,
			s.user_turn_count,
			s.llm_call_count,
			s.input_tokens,
			s.output_tokens,
			s.cache_tokens,
			s.reasoning_tokens,
			s.total_tokens
		from source_files sf
		join sessions s on s.session_hash = sf.session_hash
		where sf.file_key = ? and sf.provider = ?
	`, fileKey, provider)

	var source SourceFile
	var session usage.SessionSummary
	err := row.Scan(
		&source.SizeBytes,
		&source.ModifiedAt,
		&session.SessionHash,
		&session.StartedAt,
		&session.EndedAt,
		&session.UserTurnCount,
		&session.LLMCallCount,
		&session.Tokens.Input,
		&session.Tokens.Output,
		&session.Tokens.Cache,
		&session.Tokens.Reasoning,
		&session.Tokens.Total,
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
			reasoning_tokens,
			total_tokens,
			updated_at,
			need_sync,
			synced_at
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, null)
		on conflict(session_hash) do update set
			provider = excluded.provider,
			started_at = excluded.started_at,
			ended_at = excluded.ended_at,
			user_turn_count = excluded.user_turn_count,
			llm_call_count = excluded.llm_call_count,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cache_tokens = excluded.cache_tokens,
			reasoning_tokens = excluded.reasoning_tokens,
			total_tokens = excluded.total_tokens,
			updated_at = excluded.updated_at,
			need_sync = 1,
			synced_at = null
	`, session.SessionHash, provider, session.StartedAt, session.EndedAt, session.UserTurnCount, session.LLMCallCount, session.Tokens.Input, session.Tokens.Output, session.Tokens.Cache, session.Tokens.Reasoning, session.Tokens.Total, now); err != nil {
		return err
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
	`, fileKey, provider, sizeBytes, modifiedAt, session.SessionHash, now); err != nil {
		return err
	}

	return tx.Commit()
}

func (store *Store) DeleteSourceFile(ctx context.Context, provider string, fileKey string) error {
	_, err := store.db.ExecContext(ctx, `delete from source_files where file_key = ? and provider = ?`, fileKey, provider)
	return err
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
			reasoning_tokens integer not null,
			total_tokens integer not null,
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

		create index if not exists idx_sessions_provider_started_at on sessions(provider, started_at);
		create index if not exists idx_source_files_provider_modified_at on source_files(provider, modified_at);
	`)
	if err != nil {
		return err
	}
	if err := store.ensureSessionSyncColumns(ctx); err != nil {
		return err
	}
	_, err = store.db.ExecContext(ctx, `
		create index if not exists idx_sessions_need_sync on sessions(need_sync, provider, started_at);
	`)
	return err
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
	return store.normalizeSourceFileTimestamps(ctx)
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

func normalizeTimestamp(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	return parsed.In(kst).Format(time.RFC3339Nano)
}
