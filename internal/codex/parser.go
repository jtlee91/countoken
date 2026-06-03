package codex

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
)

var ErrNoTokenCounts = errors.New("codex session contains no token_count events")

var kst = time.FixedZone("KST", 9*60*60)

type SessionSummary = usage.SessionSummary
type SessionUsage = usage.SessionUsage
type TokenSummary = usage.TokenSummary

type record struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type eventPayload struct {
	Type            string          `json:"type"`
	Info            *tokenInfo      `json:"info"`
	TotalTokenUsage json.RawMessage `json:"total_token_usage"`
	LastTokenUsage  json.RawMessage `json:"last_token_usage"`
}

type tokenInfo struct {
	TotalTokenUsage json.RawMessage `json:"total_token_usage"`
	LastTokenUsage  json.RawMessage `json:"last_token_usage"`
}

type sessionPayload struct {
	ID string `json:"id"`
}

type tokenUsage struct {
	InputTokens           int `json:"input_tokens"`
	CachedInputTokens     int `json:"cached_input_tokens"`
	OutputTokens          int `json:"output_tokens"`
	ReasoningOutputTokens int `json:"reasoning_output_tokens"`
	TotalTokens           int `json:"total_tokens"`
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
	var calls []usage.UsageCall

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

		switch current.Type {
		case "session_meta":
			id, err := readSessionID(current.Payload)
			if err != nil {
				return SessionUsage{}, err
			}
			rawSessionID = id
		case "event_msg":
			eventType, lastUsage, hasLastUsage, err := readEventPayload(current.Payload)
			if err != nil {
				return SessionUsage{}, err
			}
			switch eventType {
			case "user_message":
				summary.UserTurnCount++
			case "token_count":
				if !hasLastUsage {
					continue
				}
				timestamp, err := formatKST(current.Timestamp)
				if err != nil {
					return SessionUsage{}, err
				}

				if summary.StartedAt == "" {
					summary.StartedAt = timestamp
				}
				summary.EndedAt = timestamp
				summary.LLMCallCount++
				tokens := tokenSummary(lastUsage)
				summary.Tokens.Input += tokens.Input
				summary.Tokens.Output += tokens.Output
				summary.Tokens.Cache += tokens.Cache
				summary.Tokens.Reasoning += tokens.Reasoning
				summary.Tokens.Total += tokens.Total
				calls = append(calls, usage.UsageCall{
					CallIndex:  summary.LLMCallCount,
					OccurredAt: timestamp,
					Tokens:     tokens,
				})
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return SessionUsage{}, err
	}
	if summary.LLMCallCount == 0 {
		return SessionUsage{}, ErrNoTokenCounts
	}
	if rawSessionID == "" {
		rawSessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if rawSessionID != "" {
		summary.SessionHash = hashSessionID(rawSessionID)
	}

	for index := range calls {
		calls[index].CallKey = usage.HashCallKey("codex", summary.SessionHash, calls[index].OccurredAt, fmt.Sprintf("%d", calls[index].CallIndex))
	}
	return SessionUsage{
		Summary: summary,
		Calls:   calls,
	}, nil
}

func readSessionID(raw json.RawMessage) (string, error) {
	var payload sessionPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", fmt.Errorf("parse session_meta payload: %w", err)
	}
	return strings.TrimSpace(payload.ID), nil
}

func readEventPayload(raw json.RawMessage) (string, tokenUsage, bool, error) {
	var payload eventPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", tokenUsage{}, false, fmt.Errorf("parse event_msg payload: %w", err)
	}
	if payload.Type != "token_count" {
		return payload.Type, tokenUsage{}, false, nil
	}

	var lastUsageRaw json.RawMessage
	if payload.Info != nil && len(payload.Info.LastTokenUsage) > 0 {
		lastUsageRaw = payload.Info.LastTokenUsage
	} else if len(payload.LastTokenUsage) > 0 {
		lastUsageRaw = payload.LastTokenUsage
	}
	if len(lastUsageRaw) == 0 {
		return payload.Type, tokenUsage{}, false, nil
	}
	var lastUsage tokenUsage
	if err := json.Unmarshal(lastUsageRaw, &lastUsage); err != nil {
		return payload.Type, tokenUsage{}, false, fmt.Errorf("parse last_token_usage: %w", err)
	}
	return payload.Type, lastUsage, true, nil
}

func tokenSummary(usage tokenUsage) TokenSummary {
	return TokenSummary{
		Input:     uncachedInputTokens(usage),
		Output:    usage.OutputTokens,
		Cache:     usage.CachedInputTokens,
		Reasoning: usage.ReasoningOutputTokens,
		Total:     usage.TotalTokens,
	}
}

func uncachedInputTokens(usage tokenUsage) int {
	input := usage.InputTokens - usage.CachedInputTokens
	if input < 0 {
		return 0
	}
	return input
}

func hashSessionID(value string) string {
	return usage.HashSessionID("codex", value)
}

func formatKST(value string) (string, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return "", fmt.Errorf("parse timestamp: %w", err)
	}
	return parsed.In(kst).Format(time.RFC3339Nano), nil
}
