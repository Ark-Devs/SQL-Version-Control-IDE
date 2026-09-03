package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// SessionStore persists the renderer's workspace session — open tabs and their
// SQL, the active tab, pane sizes, expanded explorer nodes, the last repository
// — as %APPDATA%\SqlVcIde\session.json, so a restart reopens what was there.
//
// The payload is stored verbatim. Its shape belongs to the renderer
// (WorkspaceSession in src/renderer/src/state/sessionStore.ts), so adding a
// field to a tab needs no change here.
type SessionStore struct {
	mu   sync.Mutex
	path string
	data json.RawMessage
}

// nullJSON is what a caller gets before anything has ever been saved.
var nullJSON = json.RawMessage("null")

func NewSessionStore() (*SessionStore, error) {
	dir, err := appDataDir()
	if err != nil {
		return nil, err
	}
	st := &SessionStore{path: filepath.Join(dir, "session.json"), data: nullJSON}
	if data, err := os.ReadFile(st.path); err == nil && json.Valid(data) {
		st.data = data
	}
	return st, nil
}

func (st *SessionStore) Get() json.RawMessage {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.data
}

// Set replaces the saved session. The write goes via a temp file so a crash
// mid-save cannot truncate a session holding unsaved queries.
func (st *SessionStore) Set(raw json.RawMessage) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, st.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	st.data = raw
	return nil
}
