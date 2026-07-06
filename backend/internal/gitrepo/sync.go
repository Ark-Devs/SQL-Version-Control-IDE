package gitrepo

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	sqldb "database/sql"

	"svcide/internal/db"
)

// Manifest maps repo files back to database objects. It lives at
// .svcide/manifest.json inside the repo. One repo can track a whole system
// spanning several databases (e.g. Hospital, Pharmacy) on one server.
type Manifest struct {
	SourceServer string                    `json:"sourceServer"`
	SourceConnID string                    `json:"sourceConnId"`
	Databases    []string                  `json:"databases"`
	Objects      map[string]ManifestObject `json:"objects"` // repo path (slash) → object

	// legacy single-database field, migrated into Databases on read
	SourceDatabase string `json:"sourceDatabase,omitempty"`
}

type ManifestObject struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Name     string `json:"name"`
	Type     string `json:"type"`
}

const manifestPath = ".svcide/manifest.json"

// ParseManifest decodes manifest JSON (e.g. read from a git ref).
func ParseManifest(data []byte) (*Manifest, error) {
	var man Manifest
	if err := json.Unmarshal(data, &man); err != nil {
		return nil, err
	}
	man.migrate()
	return &man, nil
}

func (man *Manifest) migrate() {
	if man.Objects == nil {
		man.Objects = map[string]ManifestObject{}
	}
	if len(man.Databases) == 0 && man.SourceDatabase != "" {
		man.Databases = []string{man.SourceDatabase}
	}
	man.SourceDatabase = ""
}

func typeFolder(t string) string {
	switch t {
	case "table":
		return "Tables"
	case "view":
		return "Views"
	case "proc":
		return "StoredProcedures"
	case "tvf":
		return filepath.ToSlash(filepath.Join("Functions", "TableValued"))
	case "scalar":
		return filepath.ToSlash(filepath.Join("Functions", "Scalar"))
	case "trigger":
		return "Triggers"
	}
	return "Other"
}

// sanitizeName %XX-escapes characters that are illegal in Windows file names.
// True identifiers live in the manifest, so escaping is safe.
func sanitizeName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch r {
		case '<', '>', ':', '"', '/', '\\', '|', '?', '*', '%':
			fmt.Fprintf(&b, "%%%02X", r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ObjectPath returns the repo-relative path for an object:
// DB/<database>/<schema>/<TypeFolder>/<name>.sql
func ObjectPath(database, schema, name, objType string) string {
	return filepath.ToSlash(filepath.Join(
		"DB", sanitizeName(database), sanitizeName(schema), typeFolder(objType), sanitizeName(name)+".sql"))
}

func (m *Manager) ReadManifest() (*Manifest, error) {
	_, root, err := m.current()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(manifestPath)))
	if os.IsNotExist(err) {
		return &Manifest{Objects: map[string]ManifestObject{}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ParseManifest(data)
}

func (m *Manager) WriteManifest(man *Manifest) error {
	_, root, err := m.current()
	if err != nil {
		return err
	}
	abs := filepath.Join(root, filepath.FromSlash(manifestPath))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(man, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(abs, data, 0o644)
}

// SyncResult summarizes a database → repo sync.
type SyncResult struct {
	Written   int      `json:"written"`
	Deleted   int      `json:"deleted"`
	Warnings  []string `json:"warnings"`
	Encrypted []string `json:"encrypted"`
}

// PoolFunc resolves a database name to a connection pool on the source server.
type PoolFunc func(database string) (*sqldb.DB, error)

// Sync scripts all objects from every manifest database into the worktree,
// removing files whose objects no longer exist. Git status afterwards is the
// drift report.
func (m *Manager) Sync(ctx context.Context, poolFor PoolFunc, man *Manifest) (*SyncResult, error) {
	_, root, err := m.current()
	if err != nil {
		return nil, err
	}

	res := &SyncResult{}
	newObjects := map[string]ManifestObject{}
	seen := map[string]bool{}

	for _, database := range man.Databases {
		pool, err := poolFor(database)
		if err != nil {
			return nil, fmt.Errorf("connect to %s: %w", database, err)
		}
		modules, err := db.ScriptModules(ctx, pool)
		if err != nil {
			return nil, fmt.Errorf("script modules in %s: %w", database, err)
		}
		tables, err := db.ScriptTables(ctx, pool)
		if err != nil {
			return nil, fmt.Errorf("script tables in %s: %w", database, err)
		}

		for _, obj := range append(modules, tables...) {
			if obj.Encrypted {
				res.Encrypted = append(res.Encrypted, database+"."+obj.Schema+"."+obj.Name)
				continue
			}
			rel := ObjectPath(database, obj.Schema, obj.Name, obj.Type)
			if seen[rel] {
				res.Warnings = append(res.Warnings, fmt.Sprintf("name collision on %s (case-insensitive filesystem); %s.%s skipped", rel, obj.Schema, obj.Name))
				continue
			}
			seen[rel] = true
			newObjects[rel] = ManifestObject{Database: database, Schema: obj.Schema, Name: obj.Name, Type: obj.Type}

			abs := filepath.Join(root, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				return nil, err
			}
			existing, readErr := os.ReadFile(abs)
			if readErr != nil || string(existing) != obj.SQL {
				if err := os.WriteFile(abs, []byte(obj.SQL), 0o644); err != nil {
					return nil, err
				}
				res.Written++
			}
		}
	}

	// remove files for objects that disappeared from their databases
	for rel := range man.Objects {
		if !seen[rel] {
			abs := filepath.Join(root, filepath.FromSlash(rel))
			if err := os.Remove(abs); err == nil {
				res.Deleted++
			}
		}
	}

	man.Objects = newObjects
	if err := m.WriteManifest(man); err != nil {
		return nil, err
	}
	return res, nil
}

// DriftStatus classifies a database object against the repo worktree.
//   - "new":      exists in the DB, no file in the repo, never altered
//   - "modified": differs from the repo file — or has no file but SQL Server
//     says it was altered after creation (modify_date > create_date)
type DriftReport map[string]string // "schema.name" → status

// Drift compares one database against the worktree without writing anything.
func (m *Manager) Drift(ctx context.Context, pool *sqldb.DB, database string) (DriftReport, error) {
	_, root, err := m.current()
	if err != nil {
		return nil, err
	}
	modules, err := db.ScriptModules(ctx, pool)
	if err != nil {
		return nil, err
	}
	tables, err := db.ScriptTables(ctx, pool)
	if err != nil {
		return nil, err
	}

	report := DriftReport{}
	for _, obj := range append(modules, tables...) {
		if obj.Encrypted {
			continue
		}
		key := obj.Schema + "." + obj.Name
		rel := ObjectPath(database, obj.Schema, obj.Name, obj.Type)
		existing, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		switch {
		case readErr == nil && string(existing) == obj.SQL:
			// baseline — matches the repo
		case readErr == nil:
			report[key] = "modified"
		case obj.ModifyDate != "" && obj.ModifyDate != obj.CreateDate:
			// no file in the repo, but the server says it was altered since
			// creation — treat as modified, not new
			report[key] = "modified"
		default:
			report[key] = "new"
		}
	}
	return report, nil
}
