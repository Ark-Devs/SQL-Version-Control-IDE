package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// BindingStore maps each repository's tracked source aliases to local
// connection profile IDs, as %APPDATA%\SqlVcIde\repo-bindings.json.
//
// These bindings deliberately live outside the repository. Profile IDs come
// from this machine's connections.json and mean nothing to a teammate who
// clones the repo — the same split git makes between tracked files and the
// machine-local remotes in .git/config. Storing them in the worktree would
// also commit them: Commit stages the whole tree.
type BindingStore struct {
	mu   sync.Mutex
	path string
	// normalized repo path → alias → connection profile ID
	repos map[string]map[string]string
}

func NewBindingStore() (*BindingStore, error) {
	dir, err := appDataDir()
	if err != nil {
		return nil, err
	}
	st := &BindingStore{
		path:  filepath.Join(dir, "repo-bindings.json"),
		repos: map[string]map[string]string{},
	}
	if data, err := os.ReadFile(st.path); err == nil {
		_ = json.Unmarshal(data, &st.repos)
	}
	return st, nil
}

// repoKey normalizes a repo path so the same repository lands on one entry
// however the caller spelled it. Windows paths are case-folded because its
// filesystem is case-insensitive.
func repoKey(repoPath string) string {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		abs = filepath.Clean(repoPath)
	}
	if runtime.GOOS == "windows" {
		return strings.ToLower(abs)
	}
	return abs
}

// Get returns a copy of the repository's alias → connection ID bindings.
func (b *BindingStore) Get(repoPath string) map[string]string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := map[string]string{}
	for alias, connID := range b.repos[repoKey(repoPath)] {
		out[alias] = connID
	}
	return out
}

// ConnID looks up one source's connection. Aliases are matched
// case-insensitively, as they are in the manifest.
func (b *BindingStore) ConnID(repoPath, alias string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for a, connID := range b.repos[repoKey(repoPath)] {
		if strings.EqualFold(a, alias) && connID != "" {
			return connID, true
		}
	}
	return "", false
}

// Bind points one source alias at a local connection profile, replacing any
// binding the alias already had.
func (b *BindingStore) Bind(repoPath, alias, connID string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := repoKey(repoPath)
	if b.repos[key] == nil {
		b.repos[key] = map[string]string{}
	}
	for a := range b.repos[key] {
		if strings.EqualFold(a, alias) {
			delete(b.repos[key], a)
		}
	}
	b.repos[key][alias] = connID
	return b.save()
}

// SetAll replaces every binding for one repository.
func (b *BindingStore) SetAll(repoPath string, bindings map[string]string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := repoKey(repoPath)
	if len(bindings) == 0 {
		delete(b.repos, key)
		return b.save()
	}
	copied := make(map[string]string, len(bindings))
	for alias, connID := range bindings {
		copied[alias] = connID
	}
	b.repos[key] = copied
	return b.save()
}

// save persists the whole file. Callers hold b.mu.
func (b *BindingStore) save() error {
	data, err := json.MarshalIndent(b.repos, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(b.path, data, 0o600)
}
