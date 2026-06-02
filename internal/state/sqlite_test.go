package state

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jtlee/local-agent-usage/internal/codex"
	_ "modernc.org/sqlite"
)

func TestUpsertSourceFileStoresAuditTimestampsInKST(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.UpsertSourceFile(context.Background(), "codex", "file-key", 123, "2026-06-02T16:30:00+09:00", codex.SessionSummary{
		SessionHash:   "session-hash",
		StartedAt:     "2026-06-02T16:00:00+09:00",
		EndedAt:       "2026-06-02T16:10:00+09:00",
		UserTurnCount: 1,
		LLMCallCount:  2,
		Tokens: codex.TokenSummary{
			Input:     10,
			Output:    20,
			Cache:     5,
			Reasoning: 7,
			Total:     30,
		},
	}); err != nil {
		t.Fatalf("UpsertSourceFile() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	var updatedAt string
	if err := db.QueryRow(`select updated_at from sessions where session_hash = ?`, "session-hash").Scan(&updatedAt); err != nil {
		t.Fatalf("select updated_at error = %v", err)
	}
	if !strings.HasSuffix(updatedAt, "+09:00") {
		t.Fatalf("updated_at = %q, want KST +09:00 timestamp", updatedAt)
	}

	var lastParsedAt string
	if err := db.QueryRow(`select last_parsed_at from source_files where file_key = ?`, "file-key").Scan(&lastParsedAt); err != nil {
		t.Fatalf("select last_parsed_at error = %v", err)
	}
	if !strings.HasSuffix(lastParsedAt, "+09:00") {
		t.Fatalf("last_parsed_at = %q, want KST +09:00 timestamp", lastParsedAt)
	}
}

func TestOpenNormalizesExistingTimestampsToKST(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err := store.UpsertSourceFile(context.Background(), "codex", "file-key", 123, "2026-06-02T07:30:00Z", codex.SessionSummary{
		SessionHash:   "session-hash",
		StartedAt:     "2026-06-02T07:00:00Z",
		EndedAt:       "2026-06-02T07:10:00Z",
		UserTurnCount: 1,
		LLMCallCount:  2,
		Tokens: codex.TokenSummary{
			Input: 10,
			Total: 10,
		},
	}); err != nil {
		t.Fatalf("UpsertSourceFile() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if _, err := db.Exec(`
		update sessions
		set started_at = '2026-06-02T07:00:00Z',
		    ended_at = '2026-06-02T07:10:00Z',
		    updated_at = '2026-06-02T07:20:00Z'
		where session_hash = 'session-hash';

		update source_files
		set modified_at = '2026-06-02T07:30:00Z',
		    last_parsed_at = '2026-06-02T07:20:00Z'
		where file_key = 'file-key';
	`); err != nil {
		t.Fatalf("seed UTC timestamps error = %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close(sql db) error = %v", err)
	}

	store, err = Open(dbPath)
	if err != nil {
		t.Fatalf("reopen Open() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close(reopened) error = %v", err)
	}

	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open(recheck) error = %v", err)
	}
	defer db.Close()

	for _, query := range []string{
		`select started_at from sessions where session_hash = 'session-hash'`,
		`select ended_at from sessions where session_hash = 'session-hash'`,
		`select updated_at from sessions where session_hash = 'session-hash'`,
		`select modified_at from source_files where file_key = 'file-key'`,
		`select last_parsed_at from source_files where file_key = 'file-key'`,
	} {
		var value string
		if err := db.QueryRow(query).Scan(&value); err != nil {
			t.Fatalf("query %q error = %v", query, err)
		}
		if !strings.HasSuffix(value, "+09:00") {
			t.Fatalf("query %q returned %q, want KST +09:00 timestamp", query, value)
		}
	}
}
