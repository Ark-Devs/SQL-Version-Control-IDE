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
// .svcide/manifest.json inside the repo.
type Manifest struct {
	SourceServer   string                    `json:"sourceServer"`
	SourceDatabase string                    `json:"sourceDatabase"`
	SourceConnID   string                    `json:"sourceConnId"`
	Objects        map[string]ManifestObject `json:"objects"` // repo path (slash) → object
}

type ManifestObject struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

const manifestPath = ".svcide/manifest.json"

// ParseManifest decodes manifest JSON (e.g. read from a git ref).
func ParseManifest(data []byte) (*Manifest, error) {
	var man Manifest
	if err := json.Unmarshal(data, &man); err != nil {
		return nil, err
	}
	if man.Objects == nil {
		man.Objects = map[string]ManifestObject{}
	}
	return &man, nil
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

// ObjectPath returns the repo-relative path for an object.
func ObjectPath(schema, name, objType string) string {
	return filepath.ToSlash(filepath.Join(sanitizeName(schema), typeFolder(objType), sanitizeName(name)+".sql"))
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
	var man Manifest
	if err := json.Unmarshal(data, &man); err != nil {
		return nil, err
	}
	if man.Objects == nil {
		man.Objects = map[string]ManifestObject{}
	}
	return &man, nil
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

// Sync scripts all objects from the database into the worktree, removing
// files whose objects no longer exist. Git status afterwards is the drift
// report.
func (m *Manager) Sync(ctx context.Context, pool *sqldb.DB, man *Manifest) (*SyncResult, error) {
	_, root, err := m.current()
	if err != nil {
		return nil, err
	}

	modules, err := db.ScriptModules(ctx, pool)
	if err != nil {
		return nil, fmt.Errorf("script modules: %w", err)
	}
	tables, err := db.ScriptTables(ctx, pool)
	if err != nil {
		return nil, fmt.Errorf("script tables: %w", err)
	}
	all := append(modules, tables...)

	res := &SyncResult{}
	newObjects := map[string]ManifestObject{}
	seen := map[string]bool{}

	for _, obj := range all {
		if obj.Encrypted {
			res.Encrypted = append(res.Encrypted, obj.Schema+"."+obj.Name)
			continue
		}
		rel := ObjectPath(obj.Schema, obj.Name, obj.Type)
		if seen[rel] {
			res.Warnings = append(res.Warnings, fmt.Sprintf("name collision on %s (case-insensitive filesystem); %s.%s skipped", rel, obj.Schema, obj.Name))
			continue
		}
		seen[rel] = true
		newObjects[rel] = ManifestObject{Schema: obj.Schema, Name: obj.Name, Type: obj.Type}

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

	// remove files for objects that disappeared from the database
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
