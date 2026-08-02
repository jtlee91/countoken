package codex

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
	TurnID          string          `json:"turn_id"`
	Info            *tokenInfo      `json:"info"`
	TotalTokenUsage json.RawMessage `json:"total_token_usage"`
	LastTokenUsage  json.RawMessage `json:"last_token_usage"`
}

type tokenInfo struct {
	TotalTokenUsage json.RawMessage `json:"total_token_usage"`
	LastTokenUsage  json.RawMessage `json:"last_token_usage"`
}

type sessionPayload struct {
	ID             string `json:"id"`
	Timestamp      string `json:"timestamp"`
	ParentThreadID string `json:"parent_thread_id"`
	ForkedFromID   string `json:"forked_from_id"`
	ThreadSource   string `json:"thread_source"`
	AgentRole      string `json:"agent_role"`
	AgentNickname  string `json:"agent_nickname"`
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
	id               string
	sessionTimestamp string
	parentID         string
	threadSource     string
	depth            int
	role             string
	nickname         string
}

type tokenUsage struct {
	InputTokens           int `json:"input_tokens"`
	CachedInputTokens     int `json:"cached_input_tokens"`
	OutputTokens          int `json:"output_tokens"`
	ReasoningOutputTokens int `json:"reasoning_output_tokens"`
	TotalTokens           int `json:"total_tokens"`
}

type parsedEvent struct {
	timestamp     string
	eventType     string
	turnID        string
	totalUsage    tokenUsage
	lastUsage     tokenUsage
	hasTotalUsage bool
	hasLastUsage  bool
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
	var events []parsedEvent

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
			if rawSessionID == "" {
				meta = parsedMeta
				rawSessionID = parsedMeta.id
			}
		case "event_msg":
			parsed, err := readEventPayload(current.Payload)
			if err != nil {
				return SessionUsage{}, err
			}
			if parsed.eventType == "user_message" || parsed.eventType == "task_started" || parsed.eventType == "token_count" {
				parsed.timestamp = current.Timestamp
				events = append(events, parsed)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return SessionUsage{}, err
	}
	if rawSessionID == "" {
		rawSessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}

	ownedFrom := 0
	if meta.isSubagent() {
		if boundary, resolved := findOwnershipBoundary(meta, events); resolved {
			ownedFrom = boundary
		}
	}

	// total_token_usage is a cumulative state snapshot. Codex can emit the same
	// snapshot repeatedly (sometimes with a stale or zero last_token_usage), so a
	// call exists only when the full cumulative vector changes. Keep the previous
	// state even for inherited records: the first owned event is then compared to
	// the replay baseline that immediately precedes it.
	previousTotal := tokenUsage{}
	for index, event := range events {
		switch event.eventType {
		case "user_message":
			if index >= ownedFrom {
				summary.UserTurnCount++
			}
		case "token_count":
			changed := true
			if event.hasTotalUsage {
				changed = event.totalUsage != previousTotal
				previousTotal = event.totalUsage
			}
			if index < ownedFrom || !event.hasLastUsage || !changed {
				continue
			}
			timestamp, err := formatKST(event.timestamp)
			if err != nil {
				return SessionUsage{}, err
			}
			if summary.StartedAt == "" {
				summary.StartedAt = timestamp
			}
			summary.EndedAt = timestamp
			summary.LLMCallCount++
			tokens := tokenSummary(event.lastUsage)
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
	if summary.LLMCallCount == 0 {
		return SessionUsage{}, ErrNoTokenCounts
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
	if meta.isSubagent() {
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
		id:               strings.TrimSpace(payload.ID),
		sessionTimestamp: strings.TrimSpace(payload.Timestamp),
		threadSource:     strings.TrimSpace(payload.ThreadSource),
		role:             strings.TrimSpace(payload.AgentRole),
		nickname:         strings.TrimSpace(payload.AgentNickname),
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
	if meta.isSubagent() && meta.depth == 0 {
		meta.depth = 1
	}
	return meta, nil
}

func (meta threadMeta) isSubagent() bool {
	return meta.threadSource == "subagent" || meta.parentID != ""
}

// ownershipReferenceMillis returns the timestamp embedded in the file's own
// session UUID. Current Codex rollouts use UUIDv7 for both session and turn ids;
// copied parent turns retain their older ids while the child's own first turn is
// minted after the child session. The payload timestamp is a legacy fallback
// only. The enclosing record timestamp is intentionally never used because
// replay serialization rewrites it.
func (meta threadMeta) ownershipReferenceMillis() (int64, bool) {
	if milliseconds, ok := uuidV7Millis(meta.id); ok {
		return milliseconds, true
	}
	parsed, err := time.Parse(time.RFC3339Nano, meta.sessionTimestamp)
	if err != nil {
		return 0, false
	}
	return parsed.UnixMilli(), true
}

// findOwnershipBoundary returns the first event owned by this child file. A
// same-millisecond turn or an old turn appearing after the boundary makes the
// ordering ambiguous; in that case the caller conservatively keeps all events
// instead of silently dropping possible real usage.
func findOwnershipBoundary(meta threadMeta, events []parsedEvent) (int, bool) {
	reference, ok := meta.ownershipReferenceMillis()
	if !ok {
		return 0, false
	}
	boundary := -1
	for index, event := range events {
		if event.eventType != "task_started" {
			continue
		}
		turnMillis, ok := uuidV7Millis(event.turnID)
		if !ok {
			continue
		}
		if boundary < 0 {
			switch {
			case turnMillis == reference:
				return 0, false
			case turnMillis > reference:
				boundary = index + 1
			}
			continue
		}
		if turnMillis <= reference {
			return 0, false
		}
	}
	return boundary, boundary >= 0
}

func uuidV7Millis(value string) (int64, bool) {
	compact := strings.ReplaceAll(strings.TrimSpace(value), "-", "")
	if len(compact) != 32 || compact[12] != '7' {
		return 0, false
	}
	parsed, err := strconv.ParseUint(compact[:12], 16, 64)
	return int64(parsed), err == nil
}

func readEventPayload(raw json.RawMessage) (parsedEvent, error) {
	var payload eventPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return parsedEvent{}, fmt.Errorf("parse event_msg payload: %w", err)
	}
	result := parsedEvent{
		eventType: payload.Type,
		turnID:    strings.TrimSpace(payload.TurnID),
	}
	if payload.Type != "token_count" {
		return result, nil
	}

	if payload.Info != nil {
		var err error
		result.totalUsage, result.hasTotalUsage, err = decodeTokenUsage(payload.Info.TotalTokenUsage)
		if err != nil {
			return parsedEvent{}, fmt.Errorf("parse total_token_usage: %w", err)
		}
		result.lastUsage, result.hasLastUsage, err = decodeTokenUsage(payload.Info.LastTokenUsage)
		if err != nil {
			return parsedEvent{}, fmt.Errorf("parse last_token_usage: %w", err)
		}
	}
	if !result.hasTotalUsage {
		var err error
		result.totalUsage, result.hasTotalUsage, err = decodeTokenUsage(payload.TotalTokenUsage)
		if err != nil {
			return parsedEvent{}, fmt.Errorf("parse total_token_usage: %w", err)
		}
	}
	if !result.hasLastUsage {
		var err error
		result.lastUsage, result.hasLastUsage, err = decodeTokenUsage(payload.LastTokenUsage)
		if err != nil {
			return parsedEvent{}, fmt.Errorf("parse last_token_usage: %w", err)
		}
	}
	return result, nil
}

func decodeTokenUsage(raw json.RawMessage) (tokenUsage, bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return tokenUsage{}, false, nil
	}
	var parsed tokenUsage
	if err := json.Unmarshal(trimmed, &parsed); err != nil {
		return tokenUsage{}, false, err
	}
	return parsed, true, nil
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
