package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jtlee/local-agent-usage/internal/state"
)

func TestRunLoginGoogleOAuthStoresAuthSession(t *testing.T) {
	stateDir := t.TempDir()

	loginURL := make(chan string, 1)
	previousOpenBrowser := openBrowserURL
	openBrowserURL = func(rawURL string) error {
		loginURL <- rawURL
		return nil
	}
	t.Cleanup(func() {
		openBrowserURL = previousOpenBrowser
	})

	var tokenRequest map[string]any
	previousClient := authHTTPClient
	authHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.URL.String() != "https://example.supabase.co/auth/v1/token?grant_type=pkce" {
				t.Fatalf("token URL = %s", r.URL.String())
			}
			if r.Header.Get("apikey") != "anon-key" {
				t.Fatalf("apikey header = %q", r.Header.Get("apikey"))
			}
			if err := json.NewDecoder(r.Body).Decode(&tokenRequest); err != nil {
				t.Fatalf("Decode(token request) error = %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(`{
					"access_token": "oauth-access-token",
					"refresh_token": "oauth-refresh-token",
					"expires_in": 3600,
					"expires_at": 1780404000,
					"user": {"id": "google-user-id"}
				}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		authHTTPClient = previousClient
	})

	done := make(chan error, 1)
	var stdout bytes.Buffer
	go func() {
		done <- run([]string{
			"login",
			"--state-dir",
			stateDir,
			"--supabase-url",
			"https://example.supabase.co",
			"--anon-key",
			"anon-key",
			"--sync-endpoint",
			"https://example.supabase.co/functions/v1/sync-usage",
			"--callback-address",
			"127.0.0.1:0",
			"--timeout",
			"2s",
		}, &stdout)
	}()

	var rawLoginURL string
	select {
	case rawLoginURL = <-loginURL:
	case err := <-done:
		t.Fatalf("run(login oauth) returned before opening browser: %v", err)
	case <-time.After(2 * time.Second):
		t.Fatal("login did not open browser URL")
	}

	parsedLoginURL, err := url.Parse(rawLoginURL)
	if err != nil {
		t.Fatalf("Parse(login URL) error = %v", err)
	}
	query := parsedLoginURL.Query()
	if parsedLoginURL.String() == "" || parsedLoginURL.Path != "/auth/v1/authorize" {
		t.Fatalf("login URL = %s, want Supabase authorize URL", parsedLoginURL.String())
	}
	if query.Get("provider") != "google" {
		t.Fatalf("provider = %q, want google", query.Get("provider"))
	}
	if query.Get("code_challenge_method") != "s256" {
		t.Fatalf("code_challenge_method = %q, want s256", query.Get("code_challenge_method"))
	}
	redirectTo := query.Get("redirect_to")
	if !strings.HasPrefix(redirectTo, "http://127.0.0.1:") || !strings.HasSuffix(redirectTo, "/auth/callback") {
		t.Fatalf("redirect_to = %q, want local callback URL", redirectTo)
	}

	callbackURL := redirectTo + "?code=auth-code"
	resp, err := http.Get(callbackURL)
	if err != nil {
		t.Fatalf("GET(callback URL) error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("callback status = %s, want 200 OK", resp.Status)
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run(login oauth) error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("login did not finish after callback")
	}

	if tokenRequest["auth_code"] != "auth-code" {
		t.Fatalf("token auth_code = %#v, want auth-code", tokenRequest["auth_code"])
	}
	verifier, ok := tokenRequest["code_verifier"].(string)
	if !ok || verifier == "" {
		t.Fatalf("token code_verifier = %#v, want non-empty string", tokenRequest["code_verifier"])
	}
	if pkceChallengeForTest(verifier) != query.Get("code_challenge") {
		t.Fatalf("code challenge does not match verifier")
	}
	if strings.Contains(stdout.String(), "oauth-access-token") || strings.Contains(stdout.String(), "oauth-refresh-token") {
		t.Fatalf("login stdout leaked OAuth token: %s", stdout.String())
	}

	auth, err := loadAuthState(filepath.Join(stateDir, "auth.json"))
	if err != nil {
		t.Fatalf("loadAuthState() error = %v", err)
	}
	if auth.UserID != "google-user-id" || auth.AccessToken != "oauth-access-token" || auth.RefreshToken != "oauth-refresh-token" {
		t.Fatalf("stored auth = %+v", auth)
	}
}

func TestRunLoginStoresAuthSession(t *testing.T) {
	stateDir := t.TempDir()
	t.Setenv("TOKEN_AGENT_TEST_PASSWORD", "test-password")

	var tokenRequest map[string]any
	previousClient := authHTTPClient
	authHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s, want POST", r.Method)
			}
			if r.URL.String() != "https://example.supabase.co/auth/v1/token?grant_type=password" {
				t.Fatalf("token URL = %s", r.URL.String())
			}
			if r.Header.Get("apikey") != "anon-key" {
				t.Fatalf("apikey header = %q", r.Header.Get("apikey"))
			}
			if err := json.NewDecoder(r.Body).Decode(&tokenRequest); err != nil {
				t.Fatalf("Decode(token request) error = %v", err)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(`{
					"access_token": "access-token",
					"refresh_token": "refresh-token",
					"expires_in": 3600,
					"expires_at": 1780404000,
					"user": {"id": "user-id"}
				}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		authHTTPClient = previousClient
	})

	var stdout bytes.Buffer
	err := run([]string{
		"login",
		"--state-dir",
		stateDir,
		"--supabase-url",
		"https://example.supabase.co",
		"--anon-key",
		"anon-key",
		"--sync-endpoint",
		"https://example.supabase.co/functions/v1/sync-usage",
		"--email",
		"user@example.com",
		"--password-env",
		"TOKEN_AGENT_TEST_PASSWORD",
	}, &stdout)
	if err != nil {
		t.Fatalf("run(login) error = %v", err)
	}

	if tokenRequest["email"] != "user@example.com" || tokenRequest["password"] != "test-password" {
		t.Fatalf("token request = %#v", tokenRequest)
	}
	if strings.Contains(stdout.String(), "access-token") || strings.Contains(stdout.String(), "refresh-token") || strings.Contains(stdout.String(), "test-password") {
		t.Fatalf("login stdout leaked secret: %s", stdout.String())
	}

	authPath := filepath.Join(stateDir, "auth.json")
	info, err := os.Stat(authPath)
	if err != nil {
		t.Fatalf("Stat(auth.json) error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("auth.json mode = %o, want 600", info.Mode().Perm())
	}

	auth, err := loadAuthState(authPath)
	if err != nil {
		t.Fatalf("loadAuthState() error = %v", err)
	}
	if auth.AccessToken != "access-token" || auth.RefreshToken != "refresh-token" || auth.UserID != "user-id" {
		t.Fatalf("stored auth = %+v", auth)
	}
	if auth.SyncEndpoint != "https://example.supabase.co/functions/v1/sync-usage" {
		t.Fatalf("SyncEndpoint = %q", auth.SyncEndpoint)
	}
}

func TestRunLoginMarksExistingSessionsPendingForNewUser(t *testing.T) {
	stateDir := t.TempDir()
	t.Setenv("TOKEN_AGENT_TEST_PASSWORD", "test-password")
	seedSyncSession(t, stateDir)

	store, err := state.Open(filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("state.Open() error = %v", err)
	}
	pending, err := store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions() error = %v", err)
	}
	if err := store.MarkSessionsSynced(context.Background(), pending); err != nil {
		t.Fatalf("MarkSessionsSynced() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close(store) error = %v", err)
	}

	previousClient := authHTTPClient
	authHTTPClient = &http.Client{
		Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(`{
					"access_token": "new-access-token",
					"refresh_token": "new-refresh-token",
					"expires_in": 3600,
					"expires_at": 1780404000,
					"user": {"id": "new-user-id"}
				}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		authHTTPClient = previousClient
	})

	var stdout bytes.Buffer
	err = run([]string{
		"login",
		"--state-dir",
		stateDir,
		"--supabase-url",
		"https://example.supabase.co",
		"--anon-key",
		"anon-key",
		"--email",
		"user@example.com",
		"--password-env",
		"TOKEN_AGENT_TEST_PASSWORD",
	}, &stdout)
	if err != nil {
		t.Fatalf("run(login) error = %v", err)
	}

	store, err = state.Open(filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("state.Open(after login) error = %v", err)
	}
	defer store.Close()
	pending, err = store.ListPendingSessions(context.Background())
	if err != nil {
		t.Fatalf("ListPendingSessions(after login) error = %v", err)
	}
	if len(pending) != 1 || pending[0].SessionHash != "session-hash" {
		t.Fatalf("pending after new login = %+v, want existing session pending", pending)
	}
}

func TestRunSyncRefreshesStoredAuthBeforeUpload(t *testing.T) {
	stateDir := t.TempDir()
	seedSyncSession(t, stateDir)
	authPath := filepath.Join(stateDir, "auth.json")
	if err := saveAuthState(authPath, authState{
		SupabaseURL:  "https://example.supabase.co",
		AnonKey:      "anon-key",
		SyncEndpoint: "https://example.supabase.co/functions/v1/sync-usage",
		AccessToken:  "expired-access",
		RefreshToken: "old-refresh",
		ExpiresAt:    time.Now().Add(-time.Minute).Unix(),
		UserID:       "user-id",
	}); err != nil {
		t.Fatalf("saveAuthState() error = %v", err)
	}

	var refreshed bool
	previousAuthClient := authHTTPClient
	authHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.String() != "https://example.supabase.co/auth/v1/token?grant_type=refresh_token" {
				t.Fatalf("refresh URL = %s", r.URL.String())
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("Decode(refresh request) error = %v", err)
			}
			if body["refresh_token"] != "old-refresh" {
				t.Fatalf("refresh body = %#v", body)
			}
			refreshed = true
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(`{
					"access_token": "fresh-access",
					"refresh_token": "new-refresh",
					"expires_in": 3600,
					"expires_at": 1780407600,
					"user": {"id": "user-id"}
				}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		authHTTPClient = previousAuthClient
	})

	var uploadAuthorization string
	previousSyncClient := syncHTTPClient
	syncHTTPClient = &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			uploadAuthorization = r.Header.Get("Authorization")
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"upserted":1}`)),
			}, nil
		}),
	}
	t.Cleanup(func() {
		syncHTTPClient = previousSyncClient
	})

	var stdout bytes.Buffer
	err := run([]string{
		"sync",
		"--state-dir",
		stateDir,
	}, &stdout)
	if err != nil {
		t.Fatalf("run(sync) error = %v", err)
	}
	if !refreshed {
		t.Fatalf("sync did not refresh expired auth")
	}
	if uploadAuthorization != "Bearer fresh-access" {
		t.Fatalf("upload Authorization = %q, want fresh access token", uploadAuthorization)
	}
	auth, err := loadAuthState(authPath)
	if err != nil {
		t.Fatalf("loadAuthState() error = %v", err)
	}
	if auth.AccessToken != "fresh-access" || auth.RefreshToken != "new-refresh" {
		t.Fatalf("refreshed auth = %+v", auth)
	}
}

func seedSyncSession(t *testing.T, stateDir string) {
	t.Helper()

	db, err := sql.Open("sqlite", filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		t.Fatalf("sql.Open(sqlite state) error = %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		create table sessions (
			session_hash text primary key,
			provider text not null,
			started_at text not null,
			ended_at text not null,
			user_turn_count integer not null,
			llm_call_count integer not null,
			input_tokens integer not null,
			output_tokens integer not null,
			cache_tokens integer not null,
			reasoning_tokens integer not null,
			total_tokens integer not null,
			updated_at text not null
		);

		create table source_files (
			file_key text primary key,
			provider text not null,
			size_bytes integer not null,
			modified_at text not null,
			session_hash text not null,
			last_parsed_at text not null
		);

		insert into sessions values (
			'session-hash',
			'codex',
			'2026-06-02T13:00:00+09:00',
			'2026-06-02T13:05:00+09:00',
			3,
			5,
			100,
			20,
			70,
			4,
			190,
			'2026-06-02T13:06:00+09:00'
		);
	`); err != nil {
		t.Fatalf("seed sqlite state error = %v", err)
	}
}

func pkceChallengeForTest(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
