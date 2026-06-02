package main

import (
	"bytes"
	"encoding/json"
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
	if result.Provider != "codex" {
		t.Fatalf("Provider = %q, want codex", result.Provider)
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
		t.Fatalf("session object includes provider key: %s", stdout.String())
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
	if result.Provider != "all" {
		t.Fatalf("Provider = %q, want all", result.Provider)
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
	if result.Provider != "claude" {
		t.Fatalf("Provider = %q, want claude", result.Provider)
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
		t.Fatalf("session object includes provider key: %s", stdout.String())
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
