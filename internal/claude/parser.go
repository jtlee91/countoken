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
type SessionUsage = usage.SessionUsage
type TokenSummary = usage.TokenSummary

type record struct {
	Type        string  `json:"type"`
	Timestamp   string  `json:"timestamp"`
	SessionID   string  `json:"sessionId"`
	UUID        string  `json:"uuid"`
	ParentUUID  string  `json:"parentUuid"`
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
	UUID        string
	ParentUUID  string
	MessageID   string
	RequestID   string
	IsSidechain bool
	Model       string
	Usage       tokenUsage
}

func ParseSessionFile(path string) (SessionSummary, error) {
	parsed, err := ParseSessionUsage(path)
	if err != nil {
		return SessionSummary{}, err
	}
	return parsed.Summary, nil
}

func ParseSessionUsage(path string) (SessionUsage, error) {
	file, err := os.Open(path)
	if err != nil {
		return SessionUsage{}, err
	}
	defer file.Close()

	var summary SessionSummary
	var rawSessionID string
	var usageEntries []usageEntry
	recordsByUUID := map[string]record{}
	var userPromptCount int
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
			return SessionUsage{}, fmt.Errorf("parse jsonl record: %w", err)
		}
		if rawSessionID == "" {
			rawSessionID = strings.TrimSpace(current.SessionID)
		}
		if current.UUID != "" {
			recordsByUUID[current.UUID] = current
		}
		if isUserPrompt(current) {
			userPromptCount++
		}
		if current.Message.Usage == nil {
			continue
		}

		timestamp, err := time.Parse(time.RFC3339Nano, current.Timestamp)
		if err != nil {
			return SessionUsage{}, fmt.Errorf("parse timestamp: %w", err)
		}
		if startedAt.IsZero() || timestamp.Before(startedAt) {
			startedAt = timestamp
		}
		if endedAt.IsZero() || timestamp.After(endedAt) {
			endedAt = timestamp
		}
		usageEntries = append(usageEntries, usageEntry{
			Timestamp:   timestamp,
			UUID:        strings.TrimSpace(current.UUID),
			ParentUUID:  strings.TrimSpace(current.ParentUUID),
			MessageID:   strings.TrimSpace(current.Message.ID),
			RequestID:   strings.TrimSpace(current.RequestID),
			IsSidechain: current.IsSidechain,
			Model:       strings.TrimSpace(current.Message.Model),
			Usage:       *current.Message.Usage,
		})
	}
	if err := scanner.Err(); err != nil {
		return SessionUsage{}, err
	}
	if len(usageEntries) == 0 {
		return SessionUsage{}, ErrNoUsage
	}

	deduped := dedupeUsageEntries(usageEntries)
	summary.StartedAt = formatKST(startedAt)
	summary.EndedAt = formatKST(endedAt)
	summary.LLMCallCount = len(deduped)
	summary.UserTurnCount = linkedUserPromptCount(deduped, recordsByUUID, userPromptCount)
	calls := make([]usage.UsageCall, 0, len(deduped))
	for index, entry := range deduped {
		tokens := tokenSummary(entry.Usage)
		summary.Tokens.Input += tokens.Input
		summary.Tokens.Output += tokens.Output
		summary.Tokens.Cache += tokens.Cache
		summary.Tokens.Total += tokens.Total
		calls = append(calls, usage.UsageCall{
			CallIndex:  index + 1,
			OccurredAt: formatKST(entry.Timestamp),
			Model:      entry.Model,
			Tokens:     tokens,
		})
	}
	if rawSessionID == "" {
		rawSessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if rawSessionID != "" {
		summary.SessionHash = hashSessionID(rawSessionID)
	}
	for index := range calls {
		entry := deduped[index]
		calls[index].CallKey = usage.HashCallKey("claude", summary.SessionHash, entry.RequestID, entry.MessageID, entry.UUID, fmt.Sprintf("%d", calls[index].CallIndex))
	}

	return SessionUsage{
		Summary: summary,
		Calls:   calls,
	}, nil
}

func linkedUserPromptCount(entries []usageEntry, recordsByUUID map[string]record, fallbackUserPromptCount int) int {
	if len(recordsByUUID) == 0 {
		return fallbackUserPromptCount
	}

	userPromptUUIDs := map[string]struct{}{}
	for _, entry := range entries {
		if promptUUID := linkedUserPromptUUID(entry, recordsByUUID); promptUUID != "" {
			userPromptUUIDs[promptUUID] = struct{}{}
		}
	}
	if len(userPromptUUIDs) == 0 {
		return fallbackUserPromptCount
	}
	return len(userPromptUUIDs)
}

func linkedUserPromptUUID(entry usageEntry, recordsByUUID map[string]record) string {
	seen := map[string]struct{}{}
	for parentUUID := entry.ParentUUID; parentUUID != ""; {
		if _, ok := seen[parentUUID]; ok {
			return ""
		}
		seen[parentUUID] = struct{}{}

		parent, ok := recordsByUUID[parentUUID]
		if !ok {
			return ""
		}
		if isUserPrompt(parent) {
			return parentUUID
		}
		parentUUID = strings.TrimSpace(parent.ParentUUID)
	}
	return ""
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

func tokenSummary(usage tokenUsage) TokenSummary {
	cache := usage.CacheCreationInputTokens + usage.CacheReadInputTokens
	return TokenSummary{
		Input:  usage.InputTokens,
		Output: usage.OutputTokens,
		Cache:  cache,
		Total:  usage.InputTokens + usage.OutputTokens + cache,
	}
}

func hashSessionID(value string) string {
	return usage.HashSessionID("claude", value)
}

func formatKST(value time.Time) string {
	return value.In(kst).Format(time.RFC3339Nano)
}
