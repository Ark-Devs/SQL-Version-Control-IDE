package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-git/go-git/v5/config"
)

// Settings are per-user app preferences stored in %APPDATA%\SqlVcIde\settings.json.
type Settings struct {
	AuthorName string `json:"authorName"`
	// MirrorOnExecute mirrors successful DDL against a tracked database straight
	// into the repo worktree. Defaults to true (see defaultedMirror on load).
	MirrorOnExecute bool `json:"mirrorOnExecute"`
}

type Store struct {
	mu   sync.Mutex
	path string
	s    Settings
}

// appDataDir returns %APPDATA%\SqlVcIde (created if missing), the per-user
// directory holding preferences and the saved workspace session.
func appDataDir() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		appData = home
	}
	dir := filepath.Join(appData, "SqlVcIde")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return dir, nil
}

func NewStore() (*Store, error) {
	dir, err := appDataDir()
	if err != nil {
		return nil, err
	}
	st := &Store{path: filepath.Join(dir, "settings.json")}
	// Default before unmarshal so an absent "mirrorOnExecute" key stays true
	// (json.Unmarshal only overwrites keys present in the file), while an
	// explicit false on disk is still honored.
	st.s.MirrorOnExecute = true
	if data, err := os.ReadFile(st.path); err == nil {
		_ = json.Unmarshal(data, &st.s)
	}
	if st.s.AuthorName == "" {
		st.s.AuthorName = gitUserName()
	}
	return st, nil
}

// gitUserName reads user.name from the global git config as a sensible default.
func gitUserName() string {
	cfg, err := config.LoadConfig(config.GlobalScope)
	if err != nil {
		return ""
	}
	return cfg.User.Name
}

func (st *Store) Get() Settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.s
}

func (st *Store) Set(s Settings) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s = s
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(st.path, data, 0o600)
}
