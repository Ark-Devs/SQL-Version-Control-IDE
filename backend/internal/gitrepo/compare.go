package gitrepo

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"svcide/internal/db"
)

// Compare states classify an object's drift between the repo (at a ref) and a
// live target database.
const (
	StateMissingOnTarget = "missingOnTarget" // tracked in the repo, absent on the target
	StateDifferent       = "different"       // present in both, scripts differ
	StateOnlyOnTarget    = "onlyOnTarget"    // present on the target, not tracked in the repo
	StateIdentical       = "identical"       // present in both, scripts match
)

// CompareObject is one object's comparison result. RepoSQL/TargetSQL are
// populated only for non-identical objects to keep the payload lean.
type CompareObject struct {
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Path      string `json:"path"`
	State     string `json:"state"`
	RepoSQL   string `json:"repoSql,omitempty"`
	TargetSQL string `json:"targetSql,omitempty"`
}

// CompareResult is a full comparison across the requested databases.
type CompareResult struct {
	Objects  []CompareObject `json:"objects"`
	Warnings []string        `json:"warnings"`
}

// compareEntry is one side (repo or target) of a comparison for a single path.
type compareEntry struct {
	obj ManifestObject
	sql string
}

// classifyCompare diffs repo objects against target objects, both keyed by the
// repo-relative object path. It is deliberately DB-free so classification is
// unit-testable without a live SQL Server. Results are ordered by path.
func classifyCompare(repo, target map[string]compareEntry) []CompareObject {
	seen := map[string]bool{}
	var paths []string
	for p := range repo {
		if !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	for p := range target {
		if !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)

	out := make([]CompareObject, 0, len(paths))
	for _, path := range paths {
		r, inRepo := repo[path]
		t, inTarget := target[path]
		co := CompareObject{Path: path}
		switch {
		case inRepo && inTarget:
			co.Database, co.Schema, co.Name, co.Type = r.obj.Database, r.obj.Schema, r.obj.Name, r.obj.Type
			if r.sql == t.sql {
				co.State = StateIdentical
			} else {
				co.State = StateDifferent
				co.RepoSQL, co.TargetSQL = r.sql, t.sql
			}
		case inRepo:
			co.Database, co.Schema, co.Name, co.Type = r.obj.Database, r.obj.Schema, r.obj.Name, r.obj.Type
			co.State = StateMissingOnTarget
			co.RepoSQL = r.sql
		default:
			co.Database, co.Schema, co.Name, co.Type = t.obj.Database, t.obj.Schema, t.obj.Name, t.obj.Type
			co.State = StateOnlyOnTarget
			co.TargetSQL = t.sql
		}
		out = append(out, co)
	}
	return out
}

// ManifestAtRef reads and parses .svcide/manifest.json committed at ref. The
// special ref "WORKING" reads the worktree copy instead.
func (m *Manager) ManifestAtRef(ref string) (*Manifest, error) {
	if ref == "WORKING" {
		return m.ReadManifest()
	}
	content, err := m.FileAtRef(manifestPath, ref)
	if err != nil {
		return nil, fmt.Errorf("manifest at %s: %w", ref, err)
	}
	return ParseManifest([]byte(content))
}

// Compare diffs the repo (at ref) against live target databases. For each
// requested database it scripts the target's objects in memory (writing
// nothing to disk) and reads the repo's objects at ref, then classifies every
// object. When databases is empty it falls back to the manifest's databases.
// Encrypted target objects are skipped with a warning.
func (m *Manager) Compare(ctx context.Context, poolFor PoolFunc, ref string, databases []string) (*CompareResult, error) {
	man, err := m.ManifestAtRef(ref)
	if err != nil {
		return nil, err
	}
	if len(databases) == 0 {
		databases = man.Databases
	}

	res := &CompareResult{Objects: []CompareObject{}, Warnings: []string{}}
	for _, database := range databases {
		// repo side: manifest objects for this database, read at ref
		repo := map[string]compareEntry{}
		for path, obj := range man.Objects {
			if !strings.EqualFold(obj.Database, database) {
				continue
			}
			sql, err := m.FileAtRef(path, ref)
			if err != nil {
				res.Warnings = append(res.Warnings, fmt.Sprintf("%s could not be read at %s: %v — skipped", path, ref, err))
				continue
			}
			repo[path] = compareEntry{obj: obj, sql: sql}
		}

		// target side: script the live database in memory
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
		target := map[string]compareEntry{}
		for _, obj := range append(modules, tables...) {
			if obj.Encrypted {
				res.Warnings = append(res.Warnings, fmt.Sprintf("%s.%s.%s is encrypted on the target — skipped", database, obj.Schema, obj.Name))
				continue
			}
			path := ObjectPath(database, obj.Schema, obj.Name, obj.Type)
			target[path] = compareEntry{
				obj: ManifestObject{Database: database, Schema: obj.Schema, Name: obj.Name, Type: obj.Type},
				sql: obj.SQL,
			}
		}

		res.Objects = append(res.Objects, classifyCompare(repo, target)...)
	}
	return res, nil
}
