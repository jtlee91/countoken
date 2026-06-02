package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
