package conn

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "github.com/microsoft/go-mssqldb"
	_ "github.com/microsoft/go-mssqldb/namedpipe"    // np: protocol (local instances without TCP)
	_ "github.com/microsoft/go-mssqldb/sharedmemory" // lpc: protocol (same-machine, like SSMS)
)

// Registry keeps one *sql.DB pool per (profile, database) pair.
type Registry struct {
	mu    sync.Mutex
	store *Store
	pools map[string]*sql.DB
}

func NewRegistry(store *Store) *Registry {
	return &Registry{store: store, pools: map[string]*sql.DB{}}
}

// Get returns a pool for the profile connected to the given database
// (empty = the profile's default).
func (r *Registry) Get(profileID, database string) (*sql.DB, error) {
	key := profileID + "|" + database
	r.mu.Lock()
	if db, ok := r.pools[key]; ok {
		r.mu.Unlock()
		return db, nil
	}
	r.mu.Unlock()

	p, err := r.store.Get(profileID)
	if err != nil {
		return nil, err
	}
	pw := ""
	if p.AuthMode == "sql" {
		if pw, err = GetPassword(p.ID); err != nil {
			return nil, fmt.Errorf("read credential store: %w", err)
		}
	}
	db, err := sql.Open("sqlserver", BuildDSN(p, pw, database))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(6)
	db.SetMaxIdleConns(2)
	db.SetConnMaxIdleTime(5 * time.Minute)

	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.pools[key]; ok {
		_ = db.Close()
		return existing, nil
	}
	r.pools[key] = db
	return db, nil
}

// CloseProfile closes every pool belonging to a profile (all databases).
func (r *Registry) CloseProfile(profileID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, db := range r.pools {
		if len(key) >= len(profileID) && key[:len(profileID)] == profileID {
			_ = db.Close()
			delete(r.pools, key)
		}
	}
}

// Test opens a fresh connection for the given profile/password and returns the
// server version string. The password parameter overrides the stored one so
// the dialog can test before saving.
func Test(ctx context.Context, p Profile, password string) (string, error) {
	if p.AuthMode == "sql" && password == "" {
		password, _ = GetPassword(p.ID)
	}
	db, err := sql.Open("sqlserver", BuildDSN(p, password, ""))
	if err != nil {
		return "", err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var version string
	if err := db.QueryRowContext(ctx, "SELECT @@VERSION").Scan(&version); err != nil {
		return "", err
	}
	return version, nil
}
