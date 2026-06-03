package usage

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

type SessionUsage struct {
	Summary SessionSummary
	Calls   []UsageCall
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
