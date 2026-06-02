package usage

import (
	"crypto/sha256"
	"encoding/hex"
)

type SessionSummary struct {
	SessionHash   string       `json:"session_hash"`
	StartedAt     string       `json:"started_at"`
	EndedAt       string       `json:"ended_at"`
	UserTurnCount int          `json:"user_turn_count"`
	LLMCallCount  int          `json:"llm_call_count"`
	Tokens        TokenSummary `json:"tokens"`
}

type TokenSummary struct {
	Input     int `json:"input"`
	Output    int `json:"output"`
	Cache     int `json:"cache"`
	Reasoning int `json:"reasoning"`
	Total     int `json:"total"`
}

func HashSessionID(provider string, value string) string {
	sum := sha256.Sum256([]byte(provider + "-session:" + value))
	return hex.EncodeToString(sum[:])
}
