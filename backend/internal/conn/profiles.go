package conn

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
)

// Profile is a saved connection. Passwords are never stored here — they live
// in Windows Credential Manager keyed by the profile ID.
type Profile struct {
	ID                     string `json:"id"`
	Name                   string `json:"name"`
	Server                 string `json:"server"` // host, host,port or host\instance
	AuthMode               string `json:"authMode"` // "windows" | "sql"
	Protocol               string `json:"protocol,omitempty"` // "" (tcp) | "np" | "lpc"
	Username               string `json:"username,omitempty"`
	Database               string `json:"database,omitempty"` // default database
	Encrypt                bool   `json:"encrypt"`
	TrustServerCertificate bool   `json:"trustServerCertificate"`
}

var ErrNotFound = errors.New("profile not found")

// Store persists profiles as JSON under %APPDATA%\SqlVcIde.
type Store struct {
	mu       sync.Mutex
	path     string
	profiles []Profile
}

func NewStore() (*Store, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		appData = home
	}
	dir := filepath.Join(appData, "SqlVcIde")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "connections.json")}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		s.profiles = []Profile{}
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &s.profiles)
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.profiles, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o600)
}

func (s *Store) List() []Profile {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Profile, len(s.profiles))
	copy(out, s.profiles)
	return out
}

func (s *Store) Get(id string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.profiles {
		if p.ID == id {
			return p, nil
		}
	}
	return Profile{}, ErrNotFound
}

func (s *Store) Create(p Profile) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ID = uuid.NewString()
	if err := validate(p); err != nil {
		return Profile{}, err
	}
	s.profiles = append(s.profiles, p)
	return p, s.save()
}

func (s *Store) Update(p Profile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validate(p); err != nil {
		return err
	}
	for i := range s.profiles {
		if s.profiles[i].ID == p.ID {
			s.profiles[i] = p
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.profiles {
		if s.profiles[i].ID == id {
			s.profiles = append(s.profiles[:i], s.profiles[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

func validate(p Profile) error {
	if p.Name == "" || p.Server == "" {
		return fmt.Errorf("name and server are required")
	}
	if p.AuthMode != "windows" && p.AuthMode != "sql" {
		return fmt.Errorf("authMode must be 'windows' or 'sql'")
	}
	if p.AuthMode == "sql" && p.Username == "" {
		return fmt.Errorf("username is required for SQL authentication")
	}
	return nil
}
