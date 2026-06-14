package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	updateRepo          = "jtlee91/countoken"
	updateCheckInterval = time.Hour
)

var updateHTTPClient = &http.Client{Timeout: 8 * time.Second}

// maybeSelfUpdate replaces the running binary in place when a newer release is
// published. It is entirely best-effort: any error is ignored so it never
// disrupts inspect/sync. It only runs while the process is invoked (hook or
// manual) and checks at most once per updateCheckInterval — there is no
// background daemon or scheduler.
func maybeSelfUpdate(stateDir string) {
	if version == "dev" {
		return // unversioned local/dev build
	}
	if !shouldCheckUpdate(stateDir) {
		return
	}
	latest, err := fetchLatestVersion()
	if err != nil || latest == "" {
		return
	}
	if !isNewerVersion(latest, version) {
		return
	}
	_ = replaceRunningBinary()
}

// shouldCheckUpdate gates the check by touching a marker file. It is a
// per-invocation rate limiter, not a timer: if the binary is never invoked the
// check never happens.
func shouldCheckUpdate(stateDir string) bool {
	marker := filepath.Join(stateDir, ".update-check")
	if info, err := os.Stat(marker); err == nil {
		if time.Since(info.ModTime()) < updateCheckInterval {
			return false
		}
	}
	// Record the attempt up front so transient failures still respect the
	// interval instead of retrying on every run.
	_ = os.MkdirAll(stateDir, 0o700)
	if f, err := os.Create(marker); err == nil {
		_ = f.Close()
	}
	now := time.Now()
	_ = os.Chtimes(marker, now, now)
	return true
}

func fetchLatestVersion() (string, error) {
	url := fmt.Sprintf("https://github.com/%s/releases/latest/download/version.txt", updateRepo)
	resp, err := updateHTTPClient.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("version.txt status %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

func replaceRunningBinary() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}

	assetURL := fmt.Sprintf(
		"https://github.com/%s/releases/latest/download/token-agent-%s-%s",
		updateRepo, runtime.GOOS, runtime.GOARCH,
	)
	resp, err := updateHTTPClient.Get(assetURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %s", resp.Status)
	}

	tmp, err := os.CreateTemp(filepath.Dir(exe), ".token-agent-update-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return err
	}
	if runtime.GOOS == "darwin" {
		_ = exec.Command("xattr", "-d", "com.apple.quarantine", tmpPath).Run()
	}

	// Atomic on the same filesystem. Replacing the running executable is safe
	// on Unix: the current process keeps its open inode and the new binary is
	// used on the next invocation.
	return os.Rename(tmpPath, exe)
}

// isNewerVersion reports whether candidate is a strictly higher semver than
// current (both like "v1.2.3"). Anything unparsable compares as zero, so a
// misconfigured value never triggers a downgrade.
func isNewerVersion(candidate, current string) bool {
	c := parseSemver(candidate)
	cur := parseSemver(current)
	for i := 0; i < 3; i++ {
		if c[i] != cur[i] {
			return c[i] > cur[i]
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.SplitN(v, ".", 3)
	var out [3]int
	for i := 0; i < len(parts) && i < 3; i++ {
		out[i], _ = strconv.Atoi(parts[i])
	}
	return out
}
