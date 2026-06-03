package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultSupabaseURL     = "https://ybecqmpsrgvgpfdtkivx.supabase.co"
	defaultSyncEndpoint    = defaultSupabaseURL + "/functions/v1/sync-usage"
	defaultAnonKey         = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InliZWNxbXBzcmd2Z3BmZHRraXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTAzOTIsImV4cCI6MjA5NTk2NjM5Mn0.4NagtLAwQ2trYyipqg4MzghvCMNynlHHfdsNBdrmcqs"
	defaultCallbackAddress = "127.0.0.1:8787"
)

var authHTTPClient = http.DefaultClient
var openBrowserURL = openSystemBrowser

type authState struct {
	SupabaseURL  string `json:"supabase_url"`
	AnonKey      string `json:"anon_key"`
	SyncEndpoint string `json:"sync_endpoint"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
	UserID       string `json:"user_id,omitempty"`
}

type authTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
	User         struct {
		ID string `json:"id"`
	} `json:"user"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
	Msg              string `json:"msg"`
}

type oauthLoginOptions struct {
	SupabaseURL     string
	AnonKey         string
	Provider        string
	CallbackAddress string
	Timeout         time.Duration
	OpenBrowser     bool
	Stdout          io.Writer
}

func authPath(stateDir string) string {
	return filepath.Join(stateDir, "auth.json")
}

func loadAuthState(path string) (authState, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return authState{}, err
	}
	var auth authState
	if err := json.Unmarshal(content, &auth); err != nil {
		return authState{}, err
	}
	return auth, nil
}

func saveAuthState(path string, auth authState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	content, err := json.MarshalIndent(auth, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	if err := os.WriteFile(path, content, 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func passwordFromOptions(password string, passwordEnv string) (string, error) {
	if password != "" {
		return password, nil
	}
	if passwordEnv != "" {
		value := os.Getenv(passwordEnv)
		if value == "" {
			return "", fmt.Errorf("password env %s is empty", passwordEnv)
		}
		return value, nil
	}
	return "", errors.New("login requires --password-env or --password")
}

func passwordLogin(ctx context.Context, supabaseURL string, anonKey string, email string, password string) (authTokenResponse, error) {
	return requestToken(ctx, supabaseURL, anonKey, "password", map[string]string{
		"email":    email,
		"password": password,
	})
}

func googleOAuthLogin(ctx context.Context, options oauthLoginOptions) (authTokenResponse, error) {
	if options.Provider == "" {
		options.Provider = "google"
	}
	if options.Provider != "google" {
		return authTokenResponse{}, fmt.Errorf("unsupported OAuth provider %q: expected google", options.Provider)
	}
	if options.CallbackAddress == "" {
		options.CallbackAddress = defaultCallbackAddress
	}
	if options.Timeout <= 0 {
		options.Timeout = 5 * time.Minute
	}
	if options.Stdout == nil {
		options.Stdout = io.Discard
	}

	listener, err := net.Listen("tcp", options.CallbackAddress)
	if err != nil {
		return authTokenResponse{}, fmt.Errorf("start OAuth callback listener: %w", err)
	}
	defer listener.Close()

	callbackURL := "http://" + listener.Addr().String() + "/auth/callback"
	codeVerifier, codeChallenge, err := generatePKCEPair()
	if err != nil {
		return authTokenResponse{}, err
	}
	loginURL := buildOAuthAuthorizeURL(options.SupabaseURL, options.Provider, callbackURL, codeChallenge)

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	server := &http.Server{
		Handler: oauthCallbackHandler(codeCh, errCh),
	}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errCh <- serveErr
		}
	}()
	defer server.Close()

	fmt.Fprintf(options.Stdout, "Open this URL in your browser:\n%s\n\n", loginURL)
	if options.OpenBrowser {
		if err := openBrowserURL(loginURL); err != nil {
			fmt.Fprintf(options.Stdout, "Could not open browser automatically: %v\n", err)
		}
	}
	fmt.Fprintln(options.Stdout, "Waiting for Google login...")

	waitCtx, cancel := context.WithTimeout(ctx, options.Timeout)
	defer cancel()
	var authCode string
	select {
	case authCode = <-codeCh:
	case err := <-errCh:
		return authTokenResponse{}, fmt.Errorf("OAuth callback failed: %w", err)
	case <-waitCtx.Done():
		return authTokenResponse{}, fmt.Errorf("OAuth login timed out after %s", options.Timeout)
	}

	if err := server.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return authTokenResponse{}, err
	}
	return pkceLogin(ctx, options.SupabaseURL, options.AnonKey, authCode, codeVerifier)
}

func refreshLogin(ctx context.Context, auth authState) (authTokenResponse, error) {
	return requestToken(ctx, auth.SupabaseURL, auth.AnonKey, "refresh_token", map[string]string{
		"refresh_token": auth.RefreshToken,
	})
}

func pkceLogin(ctx context.Context, supabaseURL string, anonKey string, authCode string, codeVerifier string) (authTokenResponse, error) {
	return requestToken(ctx, supabaseURL, anonKey, "pkce", map[string]string{
		"auth_code":     authCode,
		"code_verifier": codeVerifier,
	})
}

func requestToken(ctx context.Context, supabaseURL string, anonKey string, grantType string, body map[string]string) (authTokenResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return authTokenResponse{}, err
	}
	endpoint := strings.TrimRight(supabaseURL, "/") + "/auth/v1/token?grant_type=" + grantType
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return authTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", anonKey)
	req.Header.Set("Authorization", "Bearer "+anonKey)

	resp, err := authHTTPClient.Do(req)
	if err != nil {
		return authTokenResponse{}, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return authTokenResponse{}, err
	}
	var token authTokenResponse
	if err := json.Unmarshal(responseBody, &token); err != nil {
		return authTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := token.ErrorDescription
		if message == "" {
			message = token.Msg
		}
		if message == "" {
			message = token.Error
		}
		if message == "" {
			message = string(responseBody)
		}
		return authTokenResponse{}, fmt.Errorf("auth endpoint returned %s: %s", resp.Status, message)
	}
	if token.AccessToken == "" || token.RefreshToken == "" {
		return authTokenResponse{}, errors.New("auth response missing access_token or refresh_token")
	}
	if token.ExpiresAt == 0 && token.ExpiresIn > 0 {
		token.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Unix()
	}
	return token, nil
}

func authFromTokenResponse(supabaseURL string, anonKey string, syncEndpoint string, token authTokenResponse) authState {
	return authState{
		SupabaseURL:  strings.TrimRight(supabaseURL, "/"),
		AnonKey:      anonKey,
		SyncEndpoint: syncEndpoint,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.ExpiresAt,
		UserID:       token.User.ID,
	}
}

func ensureFreshAuth(ctx context.Context, path string, refreshBefore time.Duration) (authState, error) {
	auth, err := loadAuthState(path)
	if err != nil {
		return authState{}, err
	}
	if auth.AccessToken == "" || auth.RefreshToken == "" {
		return authState{}, errors.New("auth.json is missing access_token or refresh_token")
	}
	if auth.SupabaseURL == "" {
		auth.SupabaseURL = defaultSupabaseURL
	}
	if auth.AnonKey == "" {
		auth.AnonKey = defaultAnonKey
	}
	if auth.SyncEndpoint == "" {
		auth.SyncEndpoint = defaultSyncEndpoint
	}
	refreshAt := time.Unix(auth.ExpiresAt, 0).Add(-refreshBefore)
	if auth.ExpiresAt > 0 && time.Now().Before(refreshAt) {
		return auth, nil
	}

	token, err := refreshLogin(ctx, auth)
	if err != nil {
		return authState{}, err
	}
	refreshed := authFromTokenResponse(auth.SupabaseURL, auth.AnonKey, auth.SyncEndpoint, token)
	if refreshed.UserID == "" {
		refreshed.UserID = auth.UserID
	}
	if err := saveAuthState(path, refreshed); err != nil {
		return authState{}, err
	}
	return refreshed, nil
}

func oauthCallbackHandler(codeCh chan<- string, errCh chan<- error) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		if errText := r.URL.Query().Get("error"); errText != "" {
			description := r.URL.Query().Get("error_description")
			if description != "" {
				errText = errText + ": " + description
			}
			select {
			case errCh <- errors.New(errText):
			default:
			}
			http.Error(w, "OAuth login failed.", http.StatusBadRequest)
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "Missing OAuth code.", http.StatusBadRequest)
			return
		}
		select {
		case codeCh <- code:
		default:
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, "<!doctype html><title>Login complete</title><p>Login complete. You can close this window.</p>")
	})
	return mux
}

func buildOAuthAuthorizeURL(supabaseURL string, provider string, redirectTo string, codeChallenge string) string {
	baseURL := strings.TrimRight(supabaseURL, "/") + "/auth/v1/authorize"
	authorizeURL, err := url.Parse(baseURL)
	if err != nil {
		return baseURL
	}
	query := authorizeURL.Query()
	query.Set("provider", provider)
	query.Set("redirect_to", redirectTo)
	query.Set("code_challenge", codeChallenge)
	query.Set("code_challenge_method", "s256")
	authorizeURL.RawQuery = query.Encode()
	return authorizeURL.String()
}

func generatePKCEPair() (string, string, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", "", fmt.Errorf("generate PKCE verifier: %w", err)
	}
	verifier := base64.RawURLEncoding.EncodeToString(randomBytes)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}

func openSystemBrowser(rawURL string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", rawURL).Start()
	case "linux":
		return exec.Command("xdg-open", rawURL).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL).Start()
	default:
		return fmt.Errorf("unsupported OS %q", runtime.GOOS)
	}
}
