package codex

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jtlee/local-agent-usage/internal/usage"
)

var ErrNoTokenCounts = errors.New("codex session contains no token_count events")

var kst = time.FixedZone("KST", 9*60*60)

type SessionSummary = usage.SessionSummary
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
}

type tokenInfo struct {
	TotalTokenUsage json.RawMessage `json:"total_token_usage"`
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
	file, err := os.Open(path)
	if err != nil {
		return SessionSummary{}, err
	}
	defer file.Close()

	var summary SessionSummary
	var rawSessionID string

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

		switch current.Type {
		case "session_meta":
			id, err := readSessionID(current.Payload)
			if err != nil {
				return SessionSummary{}, err
			}
			rawSessionID = id
		case "event_msg":
			eventType, usage, hasUsage, err := readEventPayload(current.Payload)
			if err != nil {
				return SessionSummary{}, err
			}
			switch eventType {
			case "user_message":
				summary.UserTurnCount++
			case "token_count":
				if !hasUsage {
					continue
				}
				timestamp, err := formatKST(current.Timestamp)
				if err != nil {
					return SessionSummary{}, err
				}
				if summary.StartedAt == "" {
					summary.StartedAt = timestamp
				}
				summary.EndedAt = timestamp
				summary.LLMCallCount++
				summary.Tokens = TokenSummary{
					Input:     uncachedInputTokens(usage),
					Output:    usage.OutputTokens,
					Cache:     usage.CachedInputTokens,
					Reasoning: usage.ReasoningOutputTokens,
					Total:     usage.TotalTokens,
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return SessionSummary{}, err
	}
	if summary.LLMCallCount == 0 {
		return SessionSummary{}, ErrNoTokenCounts
	}
	if rawSessionID != "" {
		summary.SessionHash = hashSessionID(rawSessionID)
	}

	return summary, nil
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
	var totalUsageRaw json.RawMessage
	if payload.Info != nil && len(payload.Info.TotalTokenUsage) > 0 {
		totalUsageRaw = payload.Info.TotalTokenUsage
	} else if len(payload.TotalTokenUsage) > 0 {
		totalUsageRaw = payload.TotalTokenUsage
	}
	if len(totalUsageRaw) == 0 {
		return payload.Type, tokenUsage{}, false, nil
	}
	var usage tokenUsage
	if err := json.Unmarshal(totalUsageRaw, &usage); err != nil {
		return payload.Type, tokenUsage{}, false, fmt.Errorf("parse total_token_usage: %w", err)
	}
	return payload.Type, usage, true, nil
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
