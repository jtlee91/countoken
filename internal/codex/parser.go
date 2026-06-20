package codex

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
	Type           string          `json:"type"`
	Info           *tokenInfo      `json:"info"`
	LastTokenUsage json.RawMessage `json:"last_token_usage"`
}

type tokenInfo struct {
	LastTokenUsage json.RawMessage `json:"last_token_usage"`
}

type sessionPayload struct {
	ID             string          `json:"id"`
	ParentThreadID string          `json:"parent_thread_id"`
	ForkedFromID   string          `json:"forked_from_id"`
	ThreadSource   string          `json:"thread_source"`
	AgentRole      string          `json:"agent_role"`
	AgentNickname  string          `json:"agent_nickname"`
	// Source is "cli"/"tui" (a bare string) for user sessions and an object
	// ({"subagent": {...}}) for subagent threads, so decode it lazily.
	Source json.RawMessage `json:"source"`
}

type sourceWrapper struct {
	Subagent *subagentSource `json:"subagent"`
}

type subagentSource struct {
	ThreadSpawn *threadSpawn `json:"thread_spawn"`
	// Other labels subagents in older Codex builds that omit thread_spawn, e.g.
	// {"subagent": {"other": "guardian"}}.
	Other string `json:"other"`
}

type threadSpawn struct {
	ParentThreadID string `json:"parent_thread_id"`
	Depth          int    `json:"depth"`
	AgentRole      string `json:"agent_role"`
	AgentNickname  string `json:"agent_nickname"`
}

// threadMeta is the subagent identity pulled from a Codex session_meta payload.
type threadMeta struct {
	id           string
	parentID     string
	threadSource string
	depth        int
	role         string
	nickname     string
}

type tokenUsage struct {
	InputTokens       int `json:"input_tokens"`
	CachedInputTokens int `json:"cached_input_tokens"`
	OutputTokens      int `json:"output_tokens"`
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
	var meta threadMeta

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
			parsedMeta, err := readThreadMeta(current.Payload)
			if err != nil {
				return SessionUsage{}, err
			}
			meta = parsedMeta
			rawSessionID = parsedMeta.id
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

	result := SessionUsage{
		Summary:         summary,
		Calls:           calls,
		OwnSessionID:    rawSessionID,
		ParentSessionID: meta.parentID,
	}
	if meta.threadSource == "subagent" {
		result.Agent = usage.AgentMeta{
			AgentKey:     rawSessionID,
			ParentKey:    meta.parentID,
			ThreadSource: "subagent",
			Depth:        meta.depth,
			LabelType:    meta.role,
			LabelText:    meta.nickname,
		}
	} else {
		result.Agent = usage.AgentMeta{
			AgentKey:     "main",
			ThreadSource: "user",
			LabelType:    "main",
			LabelText:    "메인 턴",
		}
	}
	return result, nil
}

// readThreadMeta pulls the thread identity and subagent linkage out of a Codex
// session_meta payload. The parent id is resolved with the same priority Codex
// has used across versions: top-level parent_thread_id, then the nested
// source.subagent.thread_spawn block, then forked_from_id.
func readThreadMeta(raw json.RawMessage) (threadMeta, error) {
	var payload sessionPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return threadMeta{}, fmt.Errorf("parse session_meta payload: %w", err)
	}
	meta := threadMeta{
		id:           strings.TrimSpace(payload.ID),
		threadSource: strings.TrimSpace(payload.ThreadSource),
		role:         strings.TrimSpace(payload.AgentRole),
		nickname:     strings.TrimSpace(payload.AgentNickname),
	}
	var spawn *threadSpawn
	if trimmed := bytes.TrimSpace(payload.Source); len(trimmed) > 0 && trimmed[0] == '{' {
		var wrapper sourceWrapper
		if err := json.Unmarshal(trimmed, &wrapper); err == nil && wrapper.Subagent != nil {
			spawn = wrapper.Subagent.ThreadSpawn
			if meta.role == "" {
				meta.role = strings.TrimSpace(wrapper.Subagent.Other)
			}
		}
	}
	switch {
	case strings.TrimSpace(payload.ParentThreadID) != "":
		meta.parentID = strings.TrimSpace(payload.ParentThreadID)
	case spawn != nil && strings.TrimSpace(spawn.ParentThreadID) != "":
		meta.parentID = strings.TrimSpace(spawn.ParentThreadID)
	default:
		meta.parentID = strings.TrimSpace(payload.ForkedFromID)
	}
	if spawn != nil {
		if meta.depth == 0 {
			meta.depth = spawn.Depth
		}
		if meta.role == "" {
			meta.role = strings.TrimSpace(spawn.AgentRole)
		}
		if meta.nickname == "" {
			meta.nickname = strings.TrimSpace(spawn.AgentNickname)
		}
	}
	// Subagent threads always sit at least one level under the main turn, even
	// when an older build omits the depth field.
	if meta.threadSource == "subagent" && meta.depth == 0 {
		meta.depth = 1
	}
	return meta, nil
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
		Input:  uncachedInputTokens(usage),
		Output: usage.OutputTokens,
		Cache:  usage.CachedInputTokens,
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
