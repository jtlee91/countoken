package usage

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

type SessionUsage struct {
	Summary SessionSummary
	Calls   []UsageCall

	// Agent describes this source file's contribution as a single "agent" (the
	// main turn or one subagent). One source file = one agent. Empty AgentKey
	// means the provider/file carries no subagent breakdown.
	Agent AgentMeta

	// OwnSessionID / ParentSessionID are the raw ids this file reports, used to
	// resolve Codex subagent files (separate session ids) up to their root
	// parent. Claude subagent files already share the parent's sessionId, so
	// ParentSessionID stays empty there.
	OwnSessionID    string
	ParentSessionID string

	// AgentLabels are labels this file knows about *other* agents in the same
	// session. Claude's main file carries the Task-call map (agentId →
	// subagent_type/description); the subagent file itself has no label.
	AgentLabels []AgentLabel
}

// AgentMeta is one agent row's identity within a logical session.
type AgentMeta struct {
	AgentKey     string // stable within session: codex thread id, claude agentId, or "main"
	ParentKey    string // immediate parent agent_key; "" for the main/root agent
	ThreadSource string // "user" (main) | "subagent"
	Depth        int    // nesting depth; 0 for the main turn
	LabelType    string // codex agent_role / claude subagent_type / "main"
	LabelText    string // codex agent_nickname / claude description / "메인 턴"
}

// AgentLabel maps a child agent_key to its display label and the agent that
// spawned it, sourced from the spawner's file (Claude Agent/Task calls). A child
// can be spawned from the main file or from another subagent file (nesting), so
// ParentKey carries the spawner's agent_key.
type AgentLabel struct {
	AgentKey  string
	ParentKey string
	LabelType string
	LabelText string
}

type SessionSummary struct {
	SessionHash   string       `json:"session_hash"`
	StartedAt     string       `json:"started_at"`
	EndedAt       string       `json:"ended_at"`
	UserTurnCount int          `json:"user_turn_count"`
	LLMCallCount  int          `json:"llm_call_count"`
	Tokens        TokenSummary `json:"tokens"`
}

type TokenSummary struct {
	Input  int `json:"input"`
	Output int `json:"output"`
	Cache  int `json:"cache"`
}

type UsageCall struct {
	CallKey    string
	CallIndex  int
	OccurredAt string
	Model      string
	Tokens     TokenSummary
}

func HashSessionID(provider string, value string) string {
	sum := sha256.Sum256([]byte(provider + "-session:" + value))
	return hex.EncodeToString(sum[:])
}

func HashCallKey(provider string, sessionHash string, parts ...string) string {
	value := provider + "-call:" + sessionHash + ":" + strings.Join(parts, "\x00")
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
