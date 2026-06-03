package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunInspectPrintsCodexSessionSummaries(t *testing.T) {
	sessionsDir := t.TempDir()
	copyFile(t, filepath.Join("..", "..", "testdata", "codex", "session.jsonl"), filepath.Join(sessionsDir, "session.jsonl"))
	copyFile(t, filepath.Join("..", "..", "testdata", "codex", "no-token-count.jsonl"), filepath.Join(sessionsDir, "no-token-count.jsonl"))

	var stdout bytes.Buffer
	err := run([]string{
		"inspect",
		"--provider",
		"codex",
		"--codex-sessions",
		sessionsDir,
		"--state-dir",
		t.TempDir(),
	}, &stdout)
	if err != nil {
		t.Fatalf("run(inspect) error = %v", err)
	}

	var result inspectResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout.String())
	}
	if result.FilesScanned != 2 {
		t.Fatalf("FilesScanned = %d, want 2", result.FilesScanned)
	}
	if result.SessionsFound != 1 {
		t.Fatalf("SessionsFound = %d, want 1", result.SessionsFound)
	}
	if result.FilesSkipped != 1 {
		t.Fatalf("FilesSkipped = %d, want 1", result.FilesSkipped)
	}
	if result.FilesParsed != 1 {
		t.Fatalf("FilesParsed = %d, want 1", result.FilesParsed)
	}
	if result.FilesReused != 0 {
		t.Fatalf("FilesReused = %d, want 0", result.FilesReused)
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("len(Sessions) = %d, want 1", len(result.Sessions))
	}
	if result.Sessions[0].UserTurnCount != 2 || result.Sessions[0].LLMCallCount != 2 {
		t.Fatalf("session counts = %+v, want two user turns and two llm calls", result.Sessions[0])
	}
	var raw map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		t.Fatalf("Unmarshal(raw stdout) error = %v", err)
	}
	sessions, ok := raw["sessions"].([]any)
	if !ok || len(sessions) != 1 {
		t.Fatalf("raw sessions = %#v, want one session object", raw["sessions"])
	}
	firstSession, ok := sessions[0].(map[string]any)
	if !ok {
		t.Fatalf("raw session = %#v, want object", sessions[0])
	}
	if _, ok := firstSession["provider"]; ok {
		if firstSession["provider"] != "codex" {
			t.Fatalf("session provider = %#v, want codex", firstSession["provider"])
		}
	} else {
		t.Fatalf("session object does not include provider key: %s", stdout.String())
	}
	if _, ok := raw["provider"]; ok {
		t.Fatalf("top-level output includes provider key: %s", stdout.String())
	}

	for _, forbidden := range []string{
		"do not store this prompt",
		"do not store this answer",
		"/secret/project",
		filepath.Join("testdata", "codex"),
	} {
		if strings.Contains(stdout.String(), forbidden) {
			t.Fatalf("inspect output leaked %q: %s", forbidden, stdout.String())
		}
	}
}

func TestRunInspectDefaultsToAllProviders(t *testing.T) {
	codexSessionsDir := t.TempDir()
	copyFile(t, filepath.Join("..", "..", "testdata", "codex", "session.jsonl"), filepath.Join(codexSessionsDir, "session.jsonl"))
	copyFile(t, filepath.Join("..", "..", "testdata", "codex", "no-token-count.jsonl"), filepath.Join(codexSessionsDir, "no-token-count.jsonl"))

	claudeProjectsDir := t.TempDir()
	claudeProjectDir := filepath.Join(claudeProjectsDir, "-Users-jtlee-Code")
	if err := os.MkdirAll(claudeProjectDir, 0o700); err != nil {
		t.Fatalf("MkdirAll(claudeProjectDir) error = %v", err)
	}
	copyFile(t, filepath.Join("..", "..", "testdata", "claude", "session.jsonl"), filepath.Join(claudeProjectDir, "session.jsonl"))

	var stdout bytes.Buffer
	err := run([]string{
		"inspect",
		"--codex-sessions",
		codexSessionsDir,
		"--claude-projects",
		claudeProjectsDir,
		"--state-dir",
		t.TempDir(),
	}, &stdout)
	if err != nil {
		t.Fatalf("run(inspect all) error = %v", err)
	}

	var result inspectResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout.String())
	}
	if result.FilesScanned != 3 {
		t.Fatalf("FilesScanned = %d, want codex plus claude files", result.FilesScanned)
	}
	if result.FilesParsed != 2 || result.FilesSkipped != 1 || result.FilesReused != 0 {
		t.Fatalf("parsed/skipped/reused = %d/%d/%d, want 2/1/0", result.FilesParsed, result.FilesSkipped, result.FilesReused)
	}
	if result.SessionsFound != 2 || len(result.Sessions) != 2 {
		t.Fatalf("sessions found/len = %d/%d, want 2/2", result.SessionsFound, len(result.Sessions))
	}
	var raw map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		t.Fatalf("Unmarshal(raw stdout) error = %v", err)
	}
	if _, ok := raw["provider"]; ok {
		t.Fatalf("top-level output includes provider key: %s", stdout.String())
	}
	sessions, ok := raw["sessions"].([]any)
	if !ok || len(sessions) != 2 {
		t.Fatalf("raw sessions = %#v, want two session objects", raw["sessions"])
	}
	providers := map[string]int{}
	for _, item := range sessions {
		session, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("raw session = %#v, want object", item)
		}
		provider, ok := session["provider"].(string)
		if !ok {
			t.Fatalf("session object missing string provider: %#v", session)
		}
		providers[provider]++
	}
	if providers["codex"] != 1 || providers["claude"] != 1 {
		t.Fatalf("session providers = %#v, want one codex and one claude", providers)
	}
}

func TestRunInspectQuietSuppressesOutputAndStoresState(t *testing.T) {
	sessionsDir := t.TempDir()
	copyFile(t, filepath.Join("..", "..", "testdata", "codex", "session.jsonl"), filepath.Join(sessionsDir, "session.jsonl"))
	stateDir := t.TempDir()

	var stdout bytes.Buffer
	err := run([]string{
		"inspect",
		"--provider",
		"codex",
		"--codex-sessions",
		sessionsDir,
		"--state-dir",
		stateDir,
		"--quiet",
	}, &stdout)
	if err != nil {
		t.Fatalf("run(inspect --quiet) error = %v", err)
	}
	if stdout.Len() != 0 {
		t.Fatalf("quiet stdout = %q, want empty", stdout.String())
	}

	db, err := sql.Open("sqlite", filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("sql.Open(sqlite state) error = %v", err)
	}
	defer db.Close()

	var sessionCount int
	if err := db.QueryRow(`select count(*) from sessions where provider = 'codex'`).Scan(&sessionCount); err != nil {
		t.Fatalf("select sessions count error = %v", err)
	}
	if sessionCount != 1 {
		t.Fatalf("codex session count = %d, want 1", sessionCount)
	}

	var callCount int
	if err := db.QueryRow(`select count(*) from usage_calls where provider = 'codex'`).Scan(&callCount); err != nil {
		t.Fatalf("select usage_calls count error = %v", err)
	}
	if callCount != 2 {
		t.Fatalf("codex usage call count = %d, want 2", callCount)
	}
}

func TestRunInspectPrintsClaudeSessionSummaries(t *testing.T) {
	projectsDir := t.TempDir()
	targetDir := filepath.Join(projectsDir, "-Users-jtlee-Code")
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		t.Fatalf("MkdirAll(targetDir) error = %v", err)
	}
	target := filepath.Join(targetDir, "session.jsonl")
	copyFile(t, filepath.Join("..", "..", "testdata", "claude", "session.jsonl"), target)

	var stdout bytes.Buffer
	err := run([]string{
		"inspect",
		"--provider",
		"claude",
		"--claude-projects",
		projectsDir,
		"--state-dir",
		t.TempDir(),
	}, &stdout)
	if err != nil {
		t.Fatalf("run(inspect claude) error = %v", err)
	}

	var result inspectResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout.String())
	}
	if result.FilesScanned != 1 {
		t.Fatalf("FilesScanned = %d, want 1", result.FilesScanned)
	}
	if result.FilesParsed != 1 || result.FilesReused != 0 || result.FilesSkipped != 0 {
		t.Fatalf("parsed/reused/skipped = %d/%d/%d, want 1/0/0", result.FilesParsed, result.FilesReused, result.FilesSkipped)
	}
	if result.SessionsFound != 1 || len(result.Sessions) != 1 {
		t.Fatalf("sessions found/len = %d/%d, want 1/1", result.SessionsFound, len(result.Sessions))
	}
	session := result.Sessions[0]
	if session.UserTurnCount != 2 || session.LLMCallCount != 2 {
		t.Fatalf("session counts = %+v, want two user turns and two llm calls", session)
	}
	if session.Tokens.Input != 1800 || session.Tokens.Output != 4665 || session.Tokens.Cache != 23555 || session.Tokens.Total != 30020 {
		t.Fatalf("session tokens = %+v, want deduped Claude usage totals", session.Tokens)
	}

	var raw map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		t.Fatalf("Unmarshal(raw stdout) error = %v", err)
	}
	sessions, ok := raw["sessions"].([]any)
	if !ok || len(sessions) != 1 {
		t.Fatalf("raw sessions = %#v, want one session object", raw["sessions"])
	}
	firstSession, ok := sessions[0].(map[string]any)
	if !ok {
		t.Fatalf("raw session = %#v, want object", sessions[0])
	}
	if _, ok := firstSession["provider"]; ok {
		if firstSession["provider"] != "claude" {
			t.Fatalf("session provider = %#v, want claude", firstSession["provider"])
		}
	} else {
		t.Fatalf("session object does not include provider key: %s", stdout.String())
	}
	if _, ok := raw["provider"]; ok {
		t.Fatalf("top-level output includes provider key: %s", stdout.String())
	}

	for _, forbidden := range []string{
		"do not store this prompt",
		"do not store this answer",
		"do not store this thought",
		target,
		projectsDir,
	} {
		if strings.Contains(stdout.String(), forbidden) {
			t.Fatalf("inspect output leaked %q: %s", forbidden, stdout.String())
		}
	}
}

func TestRunInspectReusesUnmodifiedSessionState(t *testing.T) {
	sessionsDir := t.TempDir()
	stateDir := t.TempDir()
	source := filepath.Join("..", "..", "testdata", "codex", "session.jsonl")
	target := filepath.Join(sessionsDir, "session.jsonl")
	copyFile(t, source, target)

	first := runInspectForTest(t, sessionsDir, stateDir)
	if first.FilesParsed != 1 || first.FilesReused != 0 {
		t.Fatalf("first run parsed/reused = %d/%d, want 1/0", first.FilesParsed, first.FilesReused)
	}
	if first.SessionsFound != 1 {
		t.Fatalf("first run SessionsFound = %d, want 1", first.SessionsFound)
	}

	stateBytes, err := os.ReadFile(filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("ReadFile(sqlite state) error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "codex-state.json")); !os.IsNotExist(err) {
		t.Fatalf("codex-state.json should not exist when sqlite state is used; stat error = %v", err)
	}
	for _, forbidden := range []string{
		target,
		sessionsDir,
		"do not store this prompt",
		"do not store this answer",
		"/secret/project",
	} {
		if strings.Contains(string(stateBytes), forbidden) {
			t.Fatalf("state leaked %q: %s", forbidden, string(stateBytes))
		}
	}

	second := runInspectForTest(t, sessionsDir, stateDir)
	if second.FilesParsed != 0 || second.FilesReused != 1 {
		t.Fatalf("second run parsed/reused = %d/%d, want 0/1", second.FilesParsed, second.FilesReused)
	}
	if second.Sessions[0].Tokens.Total != first.Sessions[0].Tokens.Total {
		t.Fatalf("cached total = %d, want %d", second.Sessions[0].Tokens.Total, first.Sessions[0].Tokens.Total)
	}

	newTime := time.Date(2026, 6, 2, 16, 0, 0, 0, time.FixedZone("KST", 9*60*60))
	if err := os.Chtimes(target, newTime, newTime); err != nil {
		t.Fatalf("Chtimes(target) error = %v", err)
	}

	third := runInspectForTest(t, sessionsDir, stateDir)
	if third.FilesParsed != 1 || third.FilesReused != 0 {
		t.Fatalf("third run parsed/reused = %d/%d, want 1/0 after mtime change", third.FilesParsed, third.FilesReused)
	}
}

func TestRunSyncPostsDailyAggregates(t *testing.T) {
	stateDir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("sql.Open(sqlite state) error = %v", err)
	}
	if _, err := db.Exec(`
		create table sessions (
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
			updated_at text not null
		);

		create table source_files (
			file_key text primary key,
			provider text not null,
			size_bytes integer not null,
			modified_at text not null,
			session_hash text not null,
			last_parsed_at text not null
		);

		create table usage_calls (
			provider text not null,
			session_hash text not null,
			call_key text not null,
			call_index integer not null,
			occurred_at text not null,
			model text,
			input_tokens integer not null,
			output_tokens integer not null,
			cache_tokens integer not null,
			reasoning_tokens integer not null,
			total_tokens integer not null,
			source_file_key text not null,
			updated_at text not null,
			primary key(provider, session_hash, call_key)
		);

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
			updated_at
		) values (
			'session-hash',
			'codex',
			'2026-06-02T13:00:00+09:00',
			'2026-06-02T13:05:00+09:00',
			3,
			5,
			100,
			20,
			70,
			4,
			190,
			'2026-06-02T13:06:00+09:00'
		);

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
			reasoning_tokens,
			total_tokens,
			source_file_key,
			updated_at
		) values
		(
			'codex',
			'session-hash',
			'call-a',
			1,
			'2026-06-02T13:01:00+09:00',
			null,
			60,
			10,
			30,
			2,
			100,
			'file-key',
			'2026-06-02T13:06:00+09:00'
		),
		(
			'codex',
			'session-hash',
			'call-b',
			2,
			'2026-06-02T13:02:00+09:00',
			'gpt-test',
			40,
			10,
			40,
			2,
			90,
			'file-key',
			'2026-06-02T13:06:00+09:00'
		);
	`); err != nil {
		t.Fatalf("seed sqlite state error = %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close(sqlite state) error = %v", err)
	}

	var requestBody map[string]any
	var requestCount int
	previousClient := syncHTTPClient
	syncHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			requestCount++
			if requestCount > 1 {
				t.Fatalf("unexpected sync request #%d after all sessions were already synced", requestCount)
			}
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.Header.Get("Authorization") != "Bearer test-token" {
				t.Fatalf("Authorization = %q, want bearer token", r.Header.Get("Authorization"))
			}
			if r.Header.Get("Content-Type") != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", r.Header.Get("Content-Type"))
			}
			if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
				t.Fatalf("Decode(request body) error = %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"upserted":1}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		syncHTTPClient = previousClient
	})

	var stdout bytes.Buffer
	err = run([]string{
		"sync",
		"--state-dir",
		stateDir,
		"--endpoint",
		"https://example.test/sync",
		"--token",
		"test-token",
	}, &stdout)
	if err != nil {
		t.Fatalf("run(sync) error = %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(sync stdout) error = %v; stdout = %s", err, stdout.String())
	}
	if result["daily_uploaded"].(float64) != 2 {
		t.Fatalf("sync result = %#v, want two uploaded daily rows", result)
	}
	if _, ok := result["sessions_uploaded"]; ok {
		t.Fatalf("sync result should not include sessions_uploaded: %#v", result)
	}
	if _, ok := requestBody["user_id"]; ok {
		t.Fatalf("request should not include user_id: %#v", requestBody)
	}
	device, ok := requestBody["device"].(map[string]any)
	if !ok {
		t.Fatalf("request missing device object: %#v", requestBody)
	}
	if device["device_id"] == "" || device["device_label"] == "" || device["platform"] == "" {
		t.Fatalf("request device = %#v, want populated device fields", device)
	}
	if _, ok := requestBody["sessions"]; ok {
		t.Fatalf("request should not include sessions: %#v", requestBody["sessions"])
	}
	if _, ok := requestBody["calls"]; ok {
		t.Fatalf("request should not include calls: %#v", requestBody["calls"])
	}
	daily, ok := requestBody["daily"].([]any)
	if !ok || len(daily) != 2 {
		t.Fatalf("request daily = %#v, want two rows", requestBody["daily"])
	}
	firstDaily := daily[0].(map[string]any)
	if firstDaily["usage_date"] != "2026-06-02" || firstDaily["provider"] != "codex" {
		t.Fatalf("request daily identity = %#v", firstDaily)
	}
	if firstDaily["session_count"].(float64) != 1 || firstDaily["llm_call_count"].(float64) != 1 {
		t.Fatalf("request daily counts = %#v", firstDaily)
	}
	if _, ok := firstDaily["local_updated_at"]; !ok {
		t.Fatalf("request daily missing local_updated_at: %#v", firstDaily)
	}
	if strings.Contains(stdout.String(), "secret") {
		t.Fatalf("sync output leaked sensitive text: %s", stdout.String())
	}

	stdout.Reset()
	err = run([]string{
		"sync",
		"--state-dir",
		stateDir,
		"--endpoint",
		"https://example.test/sync",
		"--token",
		"test-token",
	}, &stdout)
	if err != nil {
		t.Fatalf("run(sync second) error = %v", err)
	}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(second sync stdout) error = %v; stdout = %s", err, stdout.String())
	}
	if result["daily_uploaded"].(float64) != 0 {
		t.Fatalf("second sync result = %#v, want zero uploaded daily rows", result)
	}
	if _, ok := result["sessions_uploaded"]; ok {
		t.Fatalf("second sync result should not include sessions_uploaded: %#v", result)
	}
	if requestCount != 1 {
		t.Fatalf("sync request count = %d, want only first sync request", requestCount)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func runInspectForTest(t *testing.T, sessionsDir, stateDir string) inspectResult {
	t.Helper()

	var stdout bytes.Buffer
	err := run([]string{
		"inspect",
		"--provider",
		"codex",
		"--codex-sessions",
		sessionsDir,
		"--state-dir",
		stateDir,
	}, &stdout)
	if err != nil {
		t.Fatalf("run(inspect) error = %v", err)
	}

	var result inspectResult
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("Unmarshal(stdout) error = %v; stdout = %s", err, stdout.String())
	}
	return result
}

func copyFile(t *testing.T, source, target string) {
	t.Helper()

	content, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", source, err)
	}
	if err := os.WriteFile(target, content, 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", target, err)
	}
}
