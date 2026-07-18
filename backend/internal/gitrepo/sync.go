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

// layoutRoot is the top-level folder objects are scripted under.
// legacyRoot is the pre-migration name; repos created before the SQL/ layout
// stored objects under DB/ and are migrated on open (see MigrateLayout).
const (
	layoutRoot = "SQL"
	legacyRoot = "DB"
)

// ObjectPath returns the repo-relative path for an object:
// SQL/<database>/<schema>/<TypeFolder>/<name>.sql
func ObjectPath(database, schema, name, objType string) string {
	return filepath.ToSlash(filepath.Join(
		layoutRoot, sanitizeName(database), sanitizeName(schema), typeFolder(objType), sanitizeName(name)+".sql"))
}

// SQLFolderExists reports whether <repo>/SQL/ exists on disk. Combined with a
// manifest that lists databases, its absence means the repo has never been
// synced — the deterministic first-sync signal.
func (m *Manager) SQLFolderExists() bool {
	_, root, err := m.current()
	if err != nil {
		return false
	}
	info, err := os.Stat(filepath.Join(root, layoutRoot))
	return err == nil && info.IsDir()
}

// MigrateLayout upgrades a legacy DB/ worktree to the SQL/ layout when a repo
// has a DB/ directory but no SQL/ directory. It renames DB/ → SQL/ on disk and
// rewrites every manifest object key from "DB/..." to "SQL/...". The change is
// left uncommitted so the user reviews and commits it via the Git panel.
// Returns true when a migration was performed.
func (m *Manager) MigrateLayout() (bool, error) {
	_, root, err := m.current()
	if err != nil {
		return false, err
	}
	legacyDir := filepath.Join(root, legacyRoot)
	newDir := filepath.Join(root, layoutRoot)

	info, statErr := os.Stat(legacyDir)
	if statErr != nil || !info.IsDir() {
		return false, nil // no legacy tree to migrate
	}
	if _, err := os.Stat(newDir); err == nil {
		return false, nil // SQL/ already present — leave both as-is
	}

	if err := os.Rename(legacyDir, newDir); err != nil {
		return false, err
	}

	// rewrite manifest object keys DB/... → SQL/...
	man, err := m.ReadManifest()
	if err != nil {
		return true, err
	}
	if len(man.Objects) > 0 {
		rekeyed := make(map[string]ManifestObject, len(man.Objects))
		for key, obj := range man.Objects {
			rekeyed[migrateKey(key)] = obj
		}
		man.Objects = rekeyed
		if err := m.WriteManifest(man); err != nil {
			return true, err
		}
	}
	return true, nil
}

// migrateKey rewrites a single legacy DB/ manifest key to its SQL/ equivalent.
func migrateKey(key string) string {
	if key == legacyRoot {
		return layoutRoot
	}
	if strings.HasPrefix(key, legacyRoot+"/") {
		return layoutRoot + "/" + strings.TrimPrefix(key, legacyRoot+"/")
	}
	return key
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

// SyncObjectResult summarizes a single-object mirror into the worktree.
type SyncObjectResult struct {
	Skipped   bool   `json:"skipped"`
	Reason    string `json:"reason,omitempty"`
	Written   bool   `json:"written"`
	Deleted   bool   `json:"deleted"`
	Encrypted bool   `json:"encrypted"`
	Path      string `json:"path,omitempty"`
}

// candidateTypes lists every object type slug an object could be scripted as.
// Used to clean up stale files/manifest entries when an object is dropped or
// changes type (e.g. a proc replaced by a view of the same name).
var candidateTypes = []string{"table", "view", "proc", "tvf", "scalar", "trigger"}

// SyncObject mirrors one database object into the worktree and updates the
// manifest, then persists the manifest. obj is the freshly-scripted object (as
// returned by db.ScriptModule/db.ScriptTable) or nil when the object no longer
// exists in the database (a drop). schema/name identify the object for the drop
// path and for pruning stale entries; when obj is non-nil its canonical
// Schema/Name/Type from the database win.
//
// Encrypted objects are skipped (flagged, not written). Callers are responsible
// for the repo-open / database-tracked checks before calling.
func (m *Manager) SyncObject(database, schema, name string, obj *db.ScriptedObject, man *Manifest) (*SyncObjectResult, error) {
	_, root, err := m.current()
	if err != nil {
		return nil, err
	}
	if man.Objects == nil {
		man.Objects = map[string]ManifestObject{}
	}
	res := &SyncObjectResult{}

	if obj != nil && obj.Encrypted {
		res.Skipped = true
		res.Encrypted = true
		res.Reason = "object is encrypted"
		return res, nil
	}

	if obj != nil {
		// canonical identity as the database reports it
		schema, name = obj.Schema, obj.Name
		rel := ObjectPath(database, schema, name, obj.Type)

		// clear any stale files/manifest entries under other type folders
		removeObjectFiles(root, man, database, schema, name, rel)

		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return nil, err
		}
		existing, readErr := os.ReadFile(abs)
		if readErr != nil || string(existing) != obj.SQL {
			if err := os.WriteFile(abs, []byte(obj.SQL), 0o644); err != nil {
				return nil, err
			}
		}
		man.Objects[rel] = ManifestObject{Database: database, Schema: schema, Name: name, Type: obj.Type}
		res.Written = true
		res.Path = rel
		if err := m.WriteManifest(man); err != nil {
			return nil, err
		}
		return res, nil
	}

	// object no longer exists — remove it from every candidate type folder
	res.Deleted = removeObjectFiles(root, man, database, schema, name, "")
	if err := m.WriteManifest(man); err != nil {
		return nil, err
	}
	return res, nil
}

// removeObjectFiles deletes the object's .sql file in every candidate type
// folder (except keepRel) and prunes matching manifest entries. Returns true
// if any file was removed from disk. Comparison of manifest identity is
// case-insensitive to tolerate casing differences between the request and the
// stored canonical identity.
func removeObjectFiles(root string, man *Manifest, database, schema, name, keepRel string) bool {
	removedFile := false
	for _, t := range candidateTypes {
		rel := ObjectPath(database, schema, name, t)
		if rel == keepRel {
			continue
		}
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.Remove(abs); err == nil {
			removedFile = true
		}
	}
	for key, o := range man.Objects {
		if key == keepRel {
			continue
		}
		if strings.EqualFold(o.Database, database) && strings.EqualFold(o.Schema, schema) && strings.EqualFold(o.Name, name) {
			delete(man.Objects, key)
		}
	}
	return removedFile
}

// ObjectStatusEntry describes a single object's version-control state,
// derived from the git worktree status rather than a live DB comparison.
// Powers the M/A/D badges (and deleted-object ghost rows) in the explorer.
type ObjectStatusEntry struct {
	State string `json:"state"` // added | modified | deleted
	Type  string `json:"type"`
	Path  string `json:"path"`
}

// ObjectStatus maps every changed SQL/ file in the worktree back to the
// database object it represents, keyed "<database>|<schema>|<name>".
//
// Added/modified paths are resolved via the current worktree manifest.
// Deleted paths are resolved via the manifest at HEAD instead, since Sync
// rewrites the worktree manifest and drops entries for objects that no
// longer exist — HEAD still has the last-known mapping for the removed file.
// Non-SQL/ paths (the manifest itself, docs, etc.) are ignored. Returns an
// empty map (not an error) when no repository is open.
func (m *Manager) ObjectStatus() (map[string]ObjectStatusEntry, error) {
	result := map[string]ObjectStatusEntry{}
	if !m.IsOpen() {
		return result, nil
	}

	statuses, err := m.Status()
	if err != nil {
		return nil, err
	}
	if len(statuses) == 0 {
		return result, nil
	}

	man, err := m.ReadManifest()
	if err != nil {
		return nil, err
	}

	var headMan *Manifest
	headLoaded := false

	for _, fs := range statuses {
		if !strings.HasPrefix(fs.Path, layoutRoot+"/") {
			continue
		}
		obj, ok := man.Objects[fs.Path]
		if !ok && fs.State == "deleted" {
			if !headLoaded {
				headMan = m.manifestAtHEAD()
				headLoaded = true
			}
			if headMan != nil {
				obj, ok = headMan.Objects[fs.Path]
			}
		}
		if !ok {
			continue
		}
		key := obj.Database + "|" + obj.Schema + "|" + obj.Name
		result[key] = ObjectStatusEntry{State: fs.State, Type: obj.Type, Path: fs.Path}
	}
	return result, nil
}

// manifestAtHEAD reads and parses .svcide/manifest.json as committed at HEAD,
// returning nil if it can't be read (e.g. no commits yet).
func (m *Manager) manifestAtHEAD() *Manifest {
	data, err := m.FileAtRef(manifestPath, "HEAD")
	if err != nil {
		return nil
	}
	man, err := ParseManifest([]byte(data))
	if err != nil {
		return nil
	}
	return man
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
