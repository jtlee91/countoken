package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/jtlee/local-agent-usage/internal/claude"
	"github.com/jtlee/local-agent-usage/internal/codex"
	"github.com/jtlee/local-agent-usage/internal/state"
	"github.com/jtlee/local-agent-usage/internal/usage"
)

var kst = time.FixedZone("KST", 9*60*60)

var syncHTTPClient = http.DefaultClient

type inspectResult struct {
	FilesScanned  int                     `json:"files_scanned"`
	FilesParsed   int                     `json:"files_parsed"`
	FilesReused   int                     `json:"files_reused"`
	FilesSkipped  int                     `json:"files_skipped"`
	SessionsFound int                     `json:"sessions_found"`
	Sessions      []inspectSessionSummary `json:"sessions"`
}

type inspectSessionSummary struct {
	Provider string `json:"provider"`
	usage.SessionSummary
}

type fileMetadata struct {
	SizeBytes  int64
	ModifiedAt string
}

type syncResult struct {
	DailyUploaded    int `json:"daily_uploaded"`
	SessionsUploaded int `json:"sessions_uploaded"`
}

type syncPayload struct {
	Device   remoteDeviceItem         `json:"device"`
	Daily    []remoteDailyUsageItem   `json:"daily"`
	Sessions []remoteSessionUsageItem `json:"sessions"`
}

type remoteDeviceItem struct {
	DeviceID    string `json:"device_id"`
	DeviceLabel string `json:"device_label"`
	Platform    string `json:"platform"`
}

type remoteDailyUsageItem struct {
	UsageDate      string `json:"usage_date"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	SessionCount   int    `json:"session_count"`
	LLMCallCount   int    `json:"llm_call_count"`
	InputTokens    int    `json:"input_tokens"`
	OutputTokens   int    `json:"output_tokens"`
	CacheTokens    int    `json:"cache_tokens"`
	FirstUsedAt    string `json:"first_used_at"`
	LastUsedAt     string `json:"last_used_at"`
	LocalUpdatedAt string `json:"local_updated_at"`
}

type remoteSessionUsageItem struct {
	SessionHash    string `json:"session_hash"`
	Provider       string `json:"provider"`
	StartedAt      string `json:"started_at"`
	EndedAt        string `json:"ended_at"`
	UserTurnCount  int    `json:"user_turn_count"`
	LLMCallCount   int    `json:"llm_call_count"`
	InputTokens    int    `json:"input_tokens"`
	OutputTokens   int    `json:"output_tokens"`
	CacheTokens    int    `json:"cache_tokens"`
	LocalUpdatedAt string `json:"local_updated_at"`
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("expected command: inspect, login, or sync")
	}
	switch args[0] {
	case "inspect":
		return runInspect(args[1:], stdout)
	case "login":
		return runLogin(args[1:], stdout)
	case "sync":
		return runSync(args[1:], stdout)
	default:
		return errors.New("expected command: inspect, login, or sync")
	}
}

func runInspect(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("inspect", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	provider := flags.String("provider", "", "usage provider: codex, claude, or empty for all")
	codexSessions := flags.String("codex-sessions", defaultCodexSessionsDir(), "Codex sessions directory")
	claudeProjects := flags.String("claude-projects", defaultClaudeProjectsDir(), "Claude projects directory")
	stateDir := flags.String("state-dir", defaultStateDir(), "local state directory")
	quiet := flags.Bool("quiet", false, "suppress JSON output")
	if err := flags.Parse(args); err != nil {
		return err
	}

	var result inspectResult
	switch *provider {
	case "":
		codexResult, err := inspectProvider("codex", *codexSessions, *stateDir, codex.ParseSessionUsage, codex.ErrNoTokenCounts)
		if err != nil {
			return err
		}
		claudeResult, err := inspectProvider("claude", *claudeProjects, *stateDir, claude.ParseSessionUsage, claude.ErrNoUsage)
		if err != nil {
			return err
		}
		result = mergeInspectResults(codexResult, claudeResult)
	case "codex":
		codexResult, err := inspectProvider("codex", *codexSessions, *stateDir, codex.ParseSessionUsage, codex.ErrNoTokenCounts)
		if err != nil {
			return err
		}
		result = codexResult
	case "claude":
		claudeResult, err := inspectProvider("claude", *claudeProjects, *stateDir, claude.ParseSessionUsage, claude.ErrNoUsage)
		if err != nil {
			return err
		}
		result = claudeResult
	default:
		return fmt.Errorf("unsupported provider %q: expected codex or claude", *provider)
	}
	if *quiet {
		return nil
	}
	return writeInspectResult(stdout, result)
}

func runLogin(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	stateDir := flags.String("state-dir", defaultStateDir(), "local state directory")
	supabaseURL := flags.String("supabase-url", getenvDefault("TOKEN_AGENT_SUPABASE_URL", defaultSupabaseURL), "Supabase project URL")
	anonKey := flags.String("anon-key", getenvDefault("TOKEN_AGENT_SUPABASE_ANON_KEY", defaultAnonKey), "Supabase anon key")
	syncEndpoint := flags.String("sync-endpoint", getenvDefault("TOKEN_AGENT_SYNC_ENDPOINT", defaultSyncEndpoint), "sync endpoint URL")
	provider := flags.String("provider", "google", "OAuth provider for browser login")
	callbackAddress := flags.String("callback-address", getenvDefault("TOKEN_AGENT_CALLBACK_ADDRESS", defaultCallbackAddress), "local OAuth callback address")
	loginTimeout := flags.Duration("timeout", 5*time.Minute, "OAuth login timeout")
	noBrowser := flags.Bool("no-browser", false, "print OAuth URL without opening a browser")
	email := flags.String("email", os.Getenv("TOKEN_AGENT_EMAIL"), "Supabase Auth email")
	password := flags.String("password", "", "Supabase Auth password")
	passwordEnv := flags.String("password-env", "TOKEN_AGENT_PASSWORD", "environment variable containing the Supabase Auth password")
	quiet := flags.Bool("quiet", false, "suppress JSON output")
	if err := flags.Parse(args); err != nil {
		return err
	}

	ctx := context.Background()
	previousAuth, previousAuthErr := loadAuthState(authPath(*stateDir))
	var token authTokenResponse
	if *email != "" {
		resolvedPassword, err := passwordFromOptions(*password, *passwordEnv)
		if err != nil {
			return err
		}
		token, err = passwordLogin(ctx, *supabaseURL, *anonKey, *email, resolvedPassword)
		if err != nil {
			return err
		}
	} else {
		oauthStdout := stdout
		if *quiet {
			oauthStdout = io.Discard
		}
		var err error
		token, err = googleOAuthLogin(ctx, oauthLoginOptions{
			SupabaseURL:     *supabaseURL,
			AnonKey:         *anonKey,
			Provider:        *provider,
			CallbackAddress: *callbackAddress,
			Timeout:         *loginTimeout,
			OpenBrowser:     !*noBrowser,
			Stdout:          oauthStdout,
		})
		if err != nil {
			return err
		}
	}
	auth := authFromTokenResponse(*supabaseURL, *anonKey, *syncEndpoint, token)
	if err := saveAuthState(authPath(*stateDir), auth); err != nil {
		return err
	}
	store, err := state.Open(filepath.Join(*stateDir, "usage.sqlite"))
	if err != nil {
		return err
	}
	defer store.Close()
	device, err := store.EnsureLocalDevice(ctx)
	if err != nil {
		return err
	}
	if shouldMarkAllSessionsPendingAfterLogin(previousAuth, previousAuthErr, auth) {
		if err := store.MarkAllSessionsPendingSync(ctx); err != nil {
			return err
		}
	}
	if *quiet {
		return nil
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(map[string]any{
		"logged_in":    true,
		"user_id":      auth.UserID,
		"device_id":    device.DeviceID,
		"device_label": device.DeviceLabel,
		"platform":     device.Platform,
	})
}

func shouldMarkAllSessionsPendingAfterLogin(previous authState, previousErr error, next authState) bool {
	if next.UserID == "" {
		return false
	}
	if previousErr != nil {
		return true
	}
	if previous.UserID == "" {
		return true
	}
	return previous.UserID != next.UserID
}

func runSync(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("sync", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	stateDir := flags.String("state-dir", defaultStateDir(), "local state directory")
	endpoint := flags.String("endpoint", os.Getenv("TOKEN_AGENT_SYNC_ENDPOINT"), "sync endpoint URL")
	token := flags.String("token", os.Getenv("TOKEN_AGENT_SYNC_TOKEN"), "bearer token for sync endpoint")
	quiet := flags.Bool("quiet", false, "suppress JSON output")
	if err := flags.Parse(args); err != nil {
		return err
	}

	store, err := state.Open(filepath.Join(*stateDir, "usage.sqlite"))
	if err != nil {
		return err
	}
	defer store.Close()

	ctx := context.Background()
	device, err := store.EnsureLocalDevice(ctx)
	if err != nil {
		return err
	}
	sessions, err := store.ListPendingSessions(ctx)
	if err != nil {
		return err
	}
	if len(sessions) == 0 {
		return writeSyncResult(stdout, *quiet, 0, 0)
	}
	daily, err := store.ListPendingDailyUsage(ctx)
	if err != nil {
		return err
	}

	resolvedEndpoint := *endpoint
	resolvedToken := *token
	if resolvedToken == "" {
		auth, err := ensureFreshAuth(ctx, authPath(*stateDir), 5*time.Minute)
		if err != nil {
			return fmt.Errorf("sync requires --token or login: %w", err)
		}
		resolvedToken = auth.AccessToken
		if resolvedEndpoint == "" {
			resolvedEndpoint = auth.SyncEndpoint
		}
	}
	if resolvedEndpoint == "" {
		resolvedEndpoint = defaultSyncEndpoint
	}

	payload := buildSyncPayload(device, daily, sessions)
	if err := postSyncPayload(ctx, resolvedEndpoint, resolvedToken, payload); err != nil {
		return err
	}
	if err := store.MarkSessionsSynced(ctx, sessions); err != nil {
		return err
	}

	return writeSyncResult(stdout, *quiet, len(payload.Daily), len(payload.Sessions))
}

func writeSyncResult(stdout io.Writer, quiet bool, dailyUploaded int, sessionsUploaded int) error {
	if quiet {
		return nil
	}
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(syncResult{
		DailyUploaded:    dailyUploaded,
		SessionsUploaded: sessionsUploaded,
	})
}

func getenvDefault(name string, fallback string) string {
	value := os.Getenv(name)
	if value != "" {
		return value
	}
	return fallback
}

func buildSyncPayload(device state.LocalDevice, daily []state.DailyUsageRow, sessions []state.SessionRow) syncPayload {
	payload := syncPayload{
		Device: remoteDeviceItem{
			DeviceID:    device.DeviceID,
			DeviceLabel: device.DeviceLabel,
			Platform:    device.Platform,
		},
		Daily:    make([]remoteDailyUsageItem, 0, len(daily)),
		Sessions: make([]remoteSessionUsageItem, 0, len(sessions)),
	}
	for _, row := range daily {
		payload.Daily = append(payload.Daily, remoteDailyUsageItem{
			UsageDate:      row.UsageDate,
			Provider:       row.Provider,
			Model:          row.Model,
			SessionCount:   row.SessionCount,
			LLMCallCount:   row.LLMCallCount,
			InputTokens:    row.InputTokens,
			OutputTokens:   row.OutputTokens,
			CacheTokens:    row.CacheTokens,
			FirstUsedAt:    row.FirstUsedAt,
			LastUsedAt:     row.LastUsedAt,
			LocalUpdatedAt: row.LocalUpdatedAt,
		})
	}
	for _, row := range sessions {
		payload.Sessions = append(payload.Sessions, remoteSessionUsageItem{
			SessionHash:    row.SessionHash,
			Provider:       row.Provider,
			StartedAt:      row.StartedAt,
			EndedAt:        row.EndedAt,
			UserTurnCount:  row.UserTurnCount,
			LLMCallCount:   row.LLMCallCount,
			InputTokens:    row.Tokens.Input,
			OutputTokens:   row.Tokens.Output,
			CacheTokens:    row.Tokens.Cache,
			LocalUpdatedAt: row.UpdatedAt,
		})
	}
	return payload
}

func postSyncPayload(ctx context.Context, endpoint string, token string, payload syncPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := syncHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("sync endpoint returned %s: %s", resp.Status, string(responseBody))
	}
	return nil
}

type sessionParser func(path string) (usage.SessionUsage, error)

func inspectProvider(provider string, root string, stateDir string, parseSession sessionParser, skipErr error) (inspectResult, error) {
	paths, err := jsonlFiles(root)
	if err != nil {
		return inspectResult{}, err
	}
	store, err := state.Open(filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		return inspectResult{}, err
	}
	defer store.Close()

	result := inspectResult{
		FilesScanned: len(paths),
	}
	ctx := context.Background()
	for _, path := range paths {
		metadata, err := statJSONL(path)
		if err != nil {
			return inspectResult{}, err
		}
		key := fileKey(path)
		if cached, ok, err := store.SourceFile(ctx, provider, key); err != nil {
			return inspectResult{}, err
		} else if ok && cached.SizeBytes == metadata.SizeBytes && cached.ModifiedAt == metadata.ModifiedAt && cached.HasUsageCalls {
			result.FilesReused++
			result.Sessions = append(result.Sessions, inspectSessionSummary{
				Provider:       provider,
				SessionSummary: cached.Session,
			})
			continue
		}

		parsed, err := parseSession(path)
		if err != nil {
			if errors.Is(err, skipErr) {
				result.FilesSkipped++
				if err := store.DeleteSourceFile(ctx, provider, key); err != nil {
					return inspectResult{}, err
				}
				continue
			}
			return inspectResult{}, err
		}
		result.FilesParsed++
		result.Sessions = append(result.Sessions, inspectSessionSummary{
			Provider:       provider,
			SessionSummary: parsed.Summary,
		})
		if err := store.UpsertParsedSourceFile(ctx, provider, key, metadata.SizeBytes, metadata.ModifiedAt, parsed); err != nil {
			return inspectResult{}, err
		}
	}
	result.SessionsFound = len(result.Sessions)
	return result, nil
}

func mergeInspectResults(results ...inspectResult) inspectResult {
	var merged inspectResult
	for _, result := range results {
		merged.FilesScanned += result.FilesScanned
		merged.FilesParsed += result.FilesParsed
		merged.FilesReused += result.FilesReused
		merged.FilesSkipped += result.FilesSkipped
		merged.Sessions = append(merged.Sessions, result.Sessions...)
	}
	merged.SessionsFound = len(merged.Sessions)
	return merged
}

func writeInspectResult(stdout io.Writer, result inspectResult) error {
	encoder := json.NewEncoder(stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}

func jsonlFiles(root string) ([]string, error) {
	var paths []string
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if filepath.Ext(entry.Name()) == ".jsonl" {
			paths = append(paths, path)
		}
		return nil
	}); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func defaultCodexSessionsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".codex", "sessions")
	}
	return filepath.Join(home, ".codex", "sessions")
}

func defaultClaudeProjectsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".claude", "projects")
	}
	return filepath.Join(home, ".claude", "projects")
}

func defaultStateDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".mylocalagenttoken"
	}
	return filepath.Join(home, ".mylocalagenttoken")
}

func statJSONL(path string) (fileMetadata, error) {
	info, err := os.Stat(path)
	if err != nil {
		return fileMetadata{}, err
	}
	return fileMetadata{
		SizeBytes:  info.Size(),
		ModifiedAt: info.ModTime().In(kst).Format(time.RFC3339Nano),
	}, nil
}

func fileKey(path string) string {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		absolutePath = path
	}
	sum := sha256.Sum256([]byte(absolutePath))
	return hex.EncodeToString(sum[:])
}
