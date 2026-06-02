package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
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

type inspectResult struct {
	Provider      string                 `json:"provider"`
	FilesScanned  int                    `json:"files_scanned"`
	FilesParsed   int                    `json:"files_parsed"`
	FilesReused   int                    `json:"files_reused"`
	FilesSkipped  int                    `json:"files_skipped"`
	SessionsFound int                    `json:"sessions_found"`
	Sessions      []usage.SessionSummary `json:"sessions"`
}

type fileMetadata struct {
	SizeBytes  int64
	ModifiedAt string
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("expected command: inspect")
	}
	switch args[0] {
	case "inspect":
		return runInspect(args[1:], stdout)
	default:
		return errors.New("expected command: inspect")
	}
}

func runInspect(args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("inspect", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	provider := flags.String("provider", "codex", "usage provider: codex or claude")
	codexSessions := flags.String("codex-sessions", defaultCodexSessionsDir(), "Codex sessions directory")
	claudeProjects := flags.String("claude-projects", defaultClaudeProjectsDir(), "Claude projects directory")
	stateDir := flags.String("state-dir", defaultStateDir(), "local state directory")
	if err := flags.Parse(args); err != nil {
		return err
	}

	switch *provider {
	case "codex":
		return inspectProvider(stdout, "codex", *codexSessions, *stateDir, codex.ParseSessionFile, codex.ErrNoTokenCounts)
	case "claude":
		return inspectProvider(stdout, "claude", *claudeProjects, *stateDir, claude.ParseSessionFile, claude.ErrNoUsage)
	default:
		return fmt.Errorf("unsupported provider %q: expected codex or claude", *provider)
	}
}

type sessionParser func(path string) (usage.SessionSummary, error)

func inspectProvider(stdout io.Writer, provider string, root string, stateDir string, parseSession sessionParser, skipErr error) error {
	paths, err := jsonlFiles(root)
	if err != nil {
		return err
	}
	store, err := state.Open(filepath.Join(stateDir, "usage.sqlite"))
	if err != nil {
		return err
	}
	defer store.Close()

	result := inspectResult{
		Provider:     provider,
		FilesScanned: len(paths),
	}
	ctx := context.Background()
	for _, path := range paths {
		metadata, err := statJSONL(path)
		if err != nil {
			return err
		}
		key := fileKey(path)
		if cached, ok, err := store.SourceFile(ctx, provider, key); err != nil {
			return err
		} else if ok && cached.SizeBytes == metadata.SizeBytes && cached.ModifiedAt == metadata.ModifiedAt {
			result.FilesReused++
			result.Sessions = append(result.Sessions, cached.Session)
			continue
		}

		summary, err := parseSession(path)
		if err != nil {
			if errors.Is(err, skipErr) {
				result.FilesSkipped++
				if err := store.DeleteSourceFile(ctx, provider, key); err != nil {
					return err
				}
				continue
			}
			return err
		}
		result.FilesParsed++
		result.Sessions = append(result.Sessions, summary)
		if err := store.UpsertSourceFile(ctx, provider, key, metadata.SizeBytes, metadata.ModifiedAt, summary); err != nil {
			return err
		}
	}
	result.SessionsFound = len(result.Sessions)

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
