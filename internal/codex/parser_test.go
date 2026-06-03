package codex

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSessionFileSummarizesTokenCounts(t *testing.T) {
	summary, err := ParseSessionFile(filepath.Join("..", "..", "testdata", "codex", "session.jsonl"))
	if err != nil {
		t.Fatalf("ParseSessionFile() error = %v", err)
	}

	if summary.SessionHash == "" || summary.SessionHash == "raw-session-id" {
		t.Fatalf("SessionHash = %q, want non-empty hash that does not expose raw session id", summary.SessionHash)
	}
	if strings.HasPrefix(summary.SessionHash, "sha256:") {
		t.Fatalf("SessionHash = %q, want hex digest without sha256 prefix", summary.SessionHash)
	}
	if len(summary.SessionHash) != 64 {
		t.Fatalf("len(SessionHash) = %d, want 64 hex characters", len(summary.SessionHash))
	}
	if summary.StartedAt != "2026-06-02T14:17:04+09:00" {
		t.Fatalf("StartedAt = %q, want first token_count timestamp in KST", summary.StartedAt)
	}
	if summary.EndedAt != "2026-06-02T14:18:01+09:00" {
		t.Fatalf("EndedAt = %q, want last token_count timestamp in KST", summary.EndedAt)
	}
	if summary.UserTurnCount != 2 {
		t.Fatalf("UserTurnCount = %d, want 2", summary.UserTurnCount)
	}
	if summary.LLMCallCount != 2 {
		t.Fatalf("LLMCallCount = %d, want 2", summary.LLMCallCount)
	}
	if summary.Tokens.Input != 170 {
		t.Fatalf("Tokens.Input = %d, want final input excluding cached input", summary.Tokens.Input)
	}
	if summary.Tokens.Output != 35 {
		t.Fatalf("Tokens.Output = %d, want final total output", summary.Tokens.Output)
	}
	if summary.Tokens.Cache != 80 {
		t.Fatalf("Tokens.Cache = %d, want final cached input", summary.Tokens.Cache)
	}
	if summary.Tokens.Reasoning != 7 {
		t.Fatalf("Tokens.Reasoning = %d, want final reasoning output", summary.Tokens.Reasoning)
	}
	if summary.Tokens.Total != 285 {
		t.Fatalf("Tokens.Total = %d, want final total tokens", summary.Tokens.Total)
	}
}

func TestParseSessionUsageReturnsTokenCalls(t *testing.T) {
	parsed, err := ParseSessionUsage(filepath.Join("..", "..", "testdata", "codex", "session.jsonl"))
	if err != nil {
		t.Fatalf("ParseSessionUsage() error = %v", err)
	}

	if len(parsed.Calls) != 2 {
		t.Fatalf("len(Calls) = %d, want 2", len(parsed.Calls))
	}
	first := parsed.Calls[0]
	if first.CallIndex != 1 || first.OccurredAt != "2026-06-02T14:17:04+09:00" {
		t.Fatalf("first call identity = %+v, want index 1 at first token_count timestamp", first)
	}
	if first.CallKey == "" || len(first.CallKey) != 64 {
		t.Fatalf("first CallKey = %q, want 64-char hash", first.CallKey)
	}
	if first.Tokens.Input != 60 || first.Tokens.Output != 20 || first.Tokens.Cache != 40 || first.Tokens.Reasoning != 5 || first.Tokens.Total != 120 {
		t.Fatalf("first call tokens = %+v, want last_token_usage normalized tokens", first.Tokens)
	}
	second := parsed.Calls[1]
	if second.Tokens.Input != 110 || second.Tokens.Output != 15 || second.Tokens.Cache != 40 || second.Tokens.Reasoning != 2 || second.Tokens.Total != 165 {
		t.Fatalf("second call tokens = %+v, want second last_token_usage normalized tokens", second.Tokens)
	}
	if parsed.Summary.Tokens.Input != first.Tokens.Input+second.Tokens.Input {
		t.Fatalf("summary input = %d, want call sum", parsed.Summary.Tokens.Input)
	}
}

func TestParseSessionFileRejectsFilesWithoutTokenCounts(t *testing.T) {
	_, err := ParseSessionFile(filepath.Join("..", "..", "testdata", "codex", "no-token-count.jsonl"))
	if err == nil {
		t.Fatal("ParseSessionFile() error = nil, want error for session without token_count")
	}
}

func TestParseSessionFileIgnoresTokenCountEventsWithoutLastUsage(t *testing.T) {
	summary, err := ParseSessionFile(filepath.Join("..", "..", "testdata", "codex", "missing-token-usage.jsonl"))
	if err != nil {
		t.Fatalf("ParseSessionFile() error = %v", err)
	}

	if summary.LLMCallCount != 1 {
		t.Fatalf("LLMCallCount = %d, want only token_count events with last_token_usage", summary.LLMCallCount)
	}
	if summary.StartedAt != "2026-06-02T14:17:05+09:00" {
		t.Fatalf("StartedAt = %q, want first token_count timestamp with last_token_usage", summary.StartedAt)
	}
	if summary.Tokens.Total != 120 {
		t.Fatalf("Tokens.Total = %d, want 120", summary.Tokens.Total)
	}
}
