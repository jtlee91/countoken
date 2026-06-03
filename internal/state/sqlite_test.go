package state

import (
	"context"
	"database/sql"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jtlee/local-agent-usage/internal/codex"
	"github.com/jtlee/local-agent-usage/internal/usage"
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

func TestEnsureLocalDeviceCreatesAndReusesDevice(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	first, err := store.EnsureLocalDevice(context.Background())
	if err != nil {
		t.Fatalf("EnsureLocalDevice() error = %v", err)
	}
	if len(first.DeviceID) != 36 {
		t.Fatalf("DeviceID = %q, want UUID string", first.DeviceID)
	}
	if first.DeviceLabel == "" {
		t.Fatalf("DeviceLabel is empty")
	}
	if first.Platform != runtime.GOOS {
		t.Fatalf("Platform = %q, want %q", first.Platform, runtime.GOOS)
	}
	if !strings.HasSuffix(first.CreatedAt, "+09:00") || !strings.HasSuffix(first.UpdatedAt, "+09:00") {
		t.Fatalf("device timestamps = %+v, want KST timestamps", first)
	}

	second, err := store.EnsureLocalDevice(context.Background())
	if err != nil {
		t.Fatalf("EnsureLocalDevice(second) error = %v", err)
	}
	if second.DeviceID != first.DeviceID {
		t.Fatalf("second DeviceID = %q, want %q", second.DeviceID, first.DeviceID)
	}
}

func TestUpsertSourceFileMarksSessionPendingSync(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	session := codex.SessionSummary{
		SessionHash:   "session-hash",
		StartedAt:     "2026-06-02T16:00:00+09:00",
		EndedAt:       "2026-06-02T16:10:00+09:00",
		UserTurnCount: 1,
		LLMCallCount:  2,
		Tokens: codex.TokenSummary{
			Input:  10,
			Output: 20,
			Total:  30,
		},
	}
	if err := store.UpsertSourceFile(context.Background(), "codex", "file-key", 123, "2026-06-02T16:30:00+09:00", session); err != nil {
		t.Fatalf("UpsertSourceFile() error = %v", err)
	}

	pending, err := store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions() error = %v", err)
	}
	if len(pending) != 1 || pending[0].SessionHash != "session-hash" {
		t.Fatalf("pending sessions = %+v, want session-hash", pending)
	}

	if err := store.MarkSessionsSynced(context.Background(), pending); err != nil {
		t.Fatalf("MarkSessionsSynced() error = %v", err)
	}
	pending, err = store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions(after mark) error = %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending sessions after mark = %+v, want none", pending)
	}

	if err := store.UpsertSourceFile(context.Background(), "codex", "file-key", 124, "2026-06-02T16:31:00+09:00", session); err != nil {
		t.Fatalf("UpsertSourceFile(second) error = %v", err)
	}
	pending, err = store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions(after second upsert) error = %v", err)
	}
	if len(pending) != 1 || pending[0].SessionHash != "session-hash" {
		t.Fatalf("pending sessions after second upsert = %+v, want session-hash", pending)
	}
}

func TestUpsertParsedSourceFileStoresUsageCalls(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	parsed := usage.SessionUsage{
		Summary: usage.SessionSummary{
			SessionHash:   "session-hash",
			StartedAt:     "2026-06-02T16:00:00+09:00",
			EndedAt:       "2026-06-02T16:10:00+09:00",
			UserTurnCount: 1,
			LLMCallCount:  2,
			Tokens: usage.TokenSummary{
				Input:  15,
				Output: 35,
				Cache:  5,
				Total:  55,
			},
		},
		Calls: []usage.UsageCall{
			{
				CallKey:    "call-a",
				CallIndex:  1,
				OccurredAt: "2026-06-02T16:01:00+09:00",
				Model:      "model-a",
				Tokens: usage.TokenSummary{
					Input:  10,
					Output: 20,
					Cache:  5,
					Total:  35,
				},
			},
			{
				CallKey:    "call-b",
				CallIndex:  2,
				OccurredAt: "2026-06-02T16:02:00+09:00",
				Tokens: usage.TokenSummary{
					Input:  5,
					Output: 15,
					Total:  20,
				},
			},
		},
	}
	if err := store.UpsertParsedSourceFile(context.Background(), "codex", "file-key", 123, "2026-06-02T16:30:00+09:00", parsed); err != nil {
		t.Fatalf("UpsertParsedSourceFile() error = %v", err)
	}

	source, ok, err := store.SourceFile(context.Background(), "codex", "file-key")
	if err != nil {
		t.Fatalf("SourceFile() error = %v", err)
	}
	if !ok {
		t.Fatal("SourceFile() ok = false, want true")
	}
	if !source.HasUsageCalls {
		t.Fatalf("HasUsageCalls = false, want true")
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	var callCount int
	if err := db.QueryRow(`select count(*) from usage_calls where provider = 'codex' and session_hash = 'session-hash'`).Scan(&callCount); err != nil {
		t.Fatalf("select usage_calls count error = %v", err)
	}
	if callCount != 2 {
		t.Fatalf("usage call count = %d, want 2", callCount)
	}

	parsed.Calls = parsed.Calls[:1]
	parsed.Summary.LLMCallCount = 1
	parsed.Summary.Tokens = usage.TokenSummary{
		Input:  10,
		Output: 20,
		Cache:  5,
		Total:  35,
	}
	if err := store.UpsertParsedSourceFile(context.Background(), "codex", "file-key", 124, "2026-06-02T16:31:00+09:00", parsed); err != nil {
		t.Fatalf("UpsertParsedSourceFile(second) error = %v", err)
	}
	if err := db.QueryRow(`select count(*) from usage_calls where provider = 'codex' and source_file_key = 'file-key'`).Scan(&callCount); err != nil {
		t.Fatalf("select usage_calls count after replace error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("usage call count after replace = %d, want 1", callCount)
	}
}

func TestListPendingUsageCalls(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	parsed := usage.SessionUsage{
		Summary: usage.SessionSummary{
			SessionHash:   "session-hash",
			StartedAt:     "2026-06-02T16:00:00+09:00",
			EndedAt:       "2026-06-02T16:10:00+09:00",
			UserTurnCount: 1,
			LLMCallCount:  1,
			Tokens: usage.TokenSummary{
				Input: 10,
				Total: 10,
			},
		},
		Calls: []usage.UsageCall{
			{
				CallKey:    "call-a",
				CallIndex:  1,
				OccurredAt: "2026-06-02T16:01:00+09:00",
				Tokens: usage.TokenSummary{
					Input: 10,
					Total: 10,
				},
			},
		},
	}
	if err := store.UpsertParsedSourceFile(context.Background(), "codex", "file-key", 123, "2026-06-02T16:30:00+09:00", parsed); err != nil {
		t.Fatalf("UpsertParsedSourceFile() error = %v", err)
	}

	calls, err := store.ListPendingUsageCalls(context.Background())
	if err != nil {
		t.Fatalf("ListPendingUsageCalls() error = %v", err)
	}
	if len(calls) != 1 {
		t.Fatalf("pending call count = %d, want 1", len(calls))
	}
	if calls[0].Provider != "codex" || calls[0].SessionHash != "session-hash" || calls[0].CallKey != "call-a" {
		t.Fatalf("pending call identity = %+v", calls[0])
	}

	pending, err := store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions() error = %v", err)
	}
	if err := store.MarkSessionsSynced(context.Background(), pending); err != nil {
		t.Fatalf("MarkSessionsSynced() error = %v", err)
	}
	calls, err = store.ListPendingUsageCalls(context.Background())
	if err != nil {
		t.Fatalf("ListPendingUsageCalls(after sync) error = %v", err)
	}
	if len(calls) != 0 {
		t.Fatalf("pending calls after sync = %+v, want none", calls)
	}
}

func TestListPendingDailyUsageAggregatesAffectedDays(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	if err := store.UpsertParsedSourceFile(context.Background(), "codex", "file-a", 123, "2026-06-02T16:30:00+09:00", usage.SessionUsage{
		Summary: usage.SessionSummary{
			SessionHash:   "session-a",
			StartedAt:     "2026-06-02T16:00:00+09:00",
			EndedAt:       "2026-06-02T16:20:00+09:00",
			UserTurnCount: 1,
			LLMCallCount:  2,
			Tokens: usage.TokenSummary{
				Input: 15,
				Total: 15,
			},
		},
		Calls: []usage.UsageCall{
			{
				CallKey:    "call-a1",
				CallIndex:  1,
				OccurredAt: "2026-06-02T16:01:00+09:00",
				Tokens: usage.TokenSummary{
					Input: 10,
					Total: 10,
				},
			},
			{
				CallKey:    "call-a2",
				CallIndex:  2,
				OccurredAt: "2026-06-02T16:02:00+09:00",
				Model:      "model-a",
				Tokens: usage.TokenSummary{
					Input:  5,
					Output: 2,
					Cache:  3,
					Total:  10,
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpsertParsedSourceFile(session-a) error = %v", err)
	}

	pending, err := store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions() error = %v", err)
	}
	if err := store.MarkSessionsSynced(context.Background(), pending); err != nil {
		t.Fatalf("MarkSessionsSynced() error = %v", err)
	}

	if err := store.UpsertParsedSourceFile(context.Background(), "codex", "file-b", 123, "2026-06-02T16:31:00+09:00", usage.SessionUsage{
		Summary: usage.SessionSummary{
			SessionHash:   "session-b",
			StartedAt:     "2026-06-02T17:00:00+09:00",
			EndedAt:       "2026-06-02T17:10:00+09:00",
			UserTurnCount: 1,
			LLMCallCount:  1,
			Tokens: usage.TokenSummary{
				Input: 7,
				Total: 7,
			},
		},
		Calls: []usage.UsageCall{
			{
				CallKey:    "call-b1",
				CallIndex:  1,
				OccurredAt: "2026-06-02T17:01:00+09:00",
				Tokens: usage.TokenSummary{
					Input: 7,
					Total: 7,
				},
			},
		},
	}); err != nil {
		t.Fatalf("UpsertParsedSourceFile(session-b) error = %v", err)
	}

	daily, err := store.ListPendingDailyUsage(context.Background())
	if err != nil {
		t.Fatalf("ListPendingDailyUsage() error = %v", err)
	}
	if len(daily) != 2 {
		t.Fatalf("daily rows = %+v, want two rows split by model", daily)
	}
	if daily[0].UsageDate != "2026-06-02" || daily[0].Provider != "codex" || daily[0].Model != "" {
		t.Fatalf("first daily identity = %+v", daily[0])
	}
	if daily[0].SessionCount != 2 || daily[0].LLMCallCount != 2 || daily[0].InputTokens != 17 || daily[0].TotalTokens != 17 {
		t.Fatalf("first daily aggregate = %+v, want both blank-model sessions on affected day", daily[0])
	}
	if daily[1].Model != "model-a" || daily[1].SessionCount != 1 || daily[1].LLMCallCount != 1 || daily[1].TotalTokens != 10 {
		t.Fatalf("second daily aggregate = %+v, want model-a row", daily[1])
	}
}

func TestMarkAllSessionsPendingSync(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "usage.sqlite")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	for _, hash := range []string{"session-a", "session-b"} {
		if err := store.UpsertSourceFile(context.Background(), "codex", "file-"+hash, 123, "2026-06-02T16:30:00+09:00", codex.SessionSummary{
			SessionHash:   hash,
			StartedAt:     "2026-06-02T16:00:00+09:00",
			EndedAt:       "2026-06-02T16:10:00+09:00",
			UserTurnCount: 1,
			LLMCallCount:  2,
			Tokens: codex.TokenSummary{
				Input:  10,
				Output: 20,
				Total:  30,
			},
		}); err != nil {
			t.Fatalf("UpsertSourceFile(%s) error = %v", hash, err)
		}
	}

	pending, err := store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions() error = %v", err)
	}
	if err := store.MarkSessionsSynced(context.Background(), pending); err != nil {
		t.Fatalf("MarkSessionsSynced() error = %v", err)
	}
	pending, err = store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions(after mark synced) error = %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("pending sessions after mark synced = %+v, want none", pending)
	}

	if err := store.MarkAllSessionsPendingSync(context.Background()); err != nil {
		t.Fatalf("MarkAllSessionsPendingSync() error = %v", err)
	}
	pending, err = store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions(after mark all) error = %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("pending sessions after mark all = %+v, want two sessions", pending)
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
