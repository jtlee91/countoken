package claude

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
)

var ErrNoUsage = errors.New("claude session contains no usage entries")

var kst = time.FixedZone("KST", 9*60*60)

type SessionSummary = usage.SessionSummary
type TokenSummary = usage.TokenSummary

type record struct {
	Type        string  `json:"type"`
	Timestamp   string  `json:"timestamp"`
	SessionID   string  `json:"sessionId"`
	IsMeta      bool    `json:"isMeta"`
	RequestID   string  `json:"requestId"`
	IsSidechain bool    `json:"isSidechain"`
	Message     message `json:"message"`
}

type message struct {
	Role    string          `json:"role"`
	ID      string          `json:"id"`
	Model   string          `json:"model"`
	Content json.RawMessage `json:"content"`
	Usage   *tokenUsage     `json:"usage"`
}

type tokenUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

type usageEntry struct {
	Timestamp   time.Time
	MessageID   string
	RequestID   string
	IsSidechain bool
	Usage       tokenUsage
}

func ParseSessionFile(path string) (SessionSummary, error) {
	file, err := os.Open(path)
	if err != nil {
		return SessionSummary{}, err
	}
	defer file.Close()

	var summary SessionSummary
	var rawSessionID string
	var usageEntries []usageEntry
	var startedAt time.Time
	var endedAt time.Time

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 64*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var current record
		if err := json.Unmarshal([]byte(line), &current); err != nil {
			return SessionSummary{}, fmt.Errorf("parse jsonl record: %w", err)
		}
		if rawSessionID == "" {
			rawSessionID = strings.TrimSpace(current.SessionID)
		}
		if isUserPrompt(current) {
			summary.UserTurnCount++
		}
		if current.Message.Usage == nil {
			continue
		}

		timestamp, err := time.Parse(time.RFC3339Nano, current.Timestamp)
		if err != nil {
			return SessionSummary{}, fmt.Errorf("parse timestamp: %w", err)
		}
		if startedAt.IsZero() || timestamp.Before(startedAt) {
			startedAt = timestamp
		}
		if endedAt.IsZero() || timestamp.After(endedAt) {
			endedAt = timestamp
		}
		usageEntries = append(usageEntries, usageEntry{
			Timestamp:   timestamp,
			MessageID:   strings.TrimSpace(current.Message.ID),
			RequestID:   strings.TrimSpace(current.RequestID),
			IsSidechain: current.IsSidechain,
			Usage:       *current.Message.Usage,
		})
	}
	if err := scanner.Err(); err != nil {
		return SessionSummary{}, err
	}
	if len(usageEntries) == 0 {
		return SessionSummary{}, ErrNoUsage
	}

	deduped := dedupeUsageEntries(usageEntries)
	summary.StartedAt = formatKST(startedAt)
	summary.EndedAt = formatKST(endedAt)
	summary.LLMCallCount = len(deduped)
	for _, entry := range deduped {
		summary.Tokens.Input += entry.Usage.InputTokens
		summary.Tokens.Output += entry.Usage.OutputTokens
		summary.Tokens.Cache += entry.Usage.CacheCreationInputTokens + entry.Usage.CacheReadInputTokens
	}
	summary.Tokens.Total = summary.Tokens.Input + summary.Tokens.Output + summary.Tokens.Cache
	if rawSessionID == "" {
		rawSessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if rawSessionID != "" {
		summary.SessionHash = hashSessionID(rawSessionID)
	}

	return summary, nil
}

func isUserPrompt(current record) bool {
	return current.Type == "user" &&
		current.Message.Role == "user" &&
		!current.IsMeta &&
		isUserPromptContent(current.Message.Content)
}

func isUserPromptContent(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return false
	}
	if trimmed[0] == '"' {
		return true
	}
	if trimmed[0] != '[' {
		return false
	}

	var blocks []struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(trimmed, &blocks); err != nil {
		return false
	}
	hasText := false
	for _, block := range blocks {
		switch block.Type {
		case "tool_result":
			return false
		case "text":
			hasText = true
		}
	}
	return hasText
}

func dedupeUsageEntries(entries []usageEntry) []usageEntry {
	deduped := make([]usageEntry, 0, len(entries))
	for _, entry := range entries {
		index := matchingUsageEntryIndex(deduped, entry)
		if index >= 0 {
			if shouldReplaceUsageEntry(entry, deduped[index]) {
				deduped[index] = entry
			}
			continue
		}
		deduped = append(deduped, entry)
	}
	return deduped
}

func matchingUsageEntryIndex(entries []usageEntry, candidate usageEntry) int {
	if candidate.MessageID == "" {
		return -1
	}
	for index, entry := range entries {
		if entry.MessageID == candidate.MessageID && entry.RequestID == candidate.RequestID {
			return index
		}
	}
	for index, entry := range entries {
		if entry.MessageID == candidate.MessageID && (candidate.IsSidechain || entry.IsSidechain) {
			return index
		}
	}
	return -1
}

func shouldReplaceUsageEntry(candidate usageEntry, existing usageEntry) bool {
	if candidate.IsSidechain != existing.IsSidechain {
		return existing.IsSidechain
	}
	return usageTotal(candidate.Usage) > usageTotal(existing.Usage)
}

func usageTotal(usage tokenUsage) int {
	return usage.InputTokens + usage.OutputTokens + usage.CacheCreationInputTokens + usage.CacheReadInputTokens
}

func hashSessionID(value string) string {
	return usage.HashSessionID("claude", value)
}

func formatKST(value time.Time) string {
	return value.In(kst).Format(time.RFC3339Nano)
}
