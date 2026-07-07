// Package export scripts database modules into a plain folder of .sql files
// (as opposed to gitrepo's manifest-tracked worktree layout). It is meant for
// one-off drops into an arbitrary directory the user picks — no git, no
// manifest, and existing files are only touched when their content changed.
package export

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"svcide/internal/db"
)

// PoolFunc resolves a database name to a connection pool.
type PoolFunc func(database string) (*sql.DB, error)

// FileResult is one file the export touched (or left alone), path relative
// to the export folder with forward slashes.
type FileResult struct {
	Path   string `json:"path"`
	Status string `json:"status"` // added | updated | unchanged
}

// Result summarizes an export run across one or more databases.
type Result struct {
	Files            []FileResult `json:"files"`
	SkippedEncrypted []string     `json:"skippedEncrypted"`
	Warnings         []string     `json:"warnings"`
}

// statusRank orders the response: added, then updated, then unchanged.
var statusRank = map[string]int{"added": 0, "updated": 1, "unchanged": 2}

// typeSubfolder maps a scripted module type to its export subfolder. Only
// the object types db.ScriptModules returns are handled; ok is false for
// anything else (e.g. "table", which this export never scripts).
func typeSubfolder(objType string) (string, bool) {
	switch objType {
	case "proc":
		return "sp", true
	case "view":
		return "views", true
	case "scalar":
		return "scalar functions", true
	case "tvf":
		return "table valued functions", true
	case "trigger":
		return "triggers", true
	}
	return "", false
}

// sanitizeName %XX-escapes characters that are illegal in Windows file names.
// True identifiers are recoverable from the path, so escaping is safe.
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

// relPath returns the slash-separated path (relative to the export folder)
// for one object. The database segment is only included when exporting more
// than one database, so a single-database export reads as a flat sql/ tree.
func relPath(multiDB bool, database, subfolder, schema, name string) string {
	file := sanitizeName(schema+"."+name) + ".sql"
	if multiDB {
		return path.Join("sql", sanitizeName(database), subfolder, file)
	}
	return path.Join("sql", subfolder, file)
}

// Run scripts every proc/view/function/trigger in the given databases into
// <folder>/sql/..., writing only files that are new or changed and never
// deleting anything already there (the folder may hold unrelated content).
func Run(ctx context.Context, folder string, databases []string, poolFor PoolFunc) (*Result, error) {
	if strings.TrimSpace(folder) == "" {
		return nil, fmt.Errorf("folder is required")
	}
	if len(databases) == 0 {
		return nil, fmt.Errorf("at least one database is required")
	}
	if err := os.MkdirAll(filepath.Join(folder, "sql"), 0o755); err != nil {
		return nil, err
	}

	res := &Result{}
	multiDB := len(databases) > 1
	for _, database := range databases {
		pool, err := poolFor(database)
		if err != nil {
			return nil, fmt.Errorf("connect to %s: %w", database, err)
		}
		modules, err := db.ScriptModules(ctx, pool)
		if err != nil {
			return nil, fmt.Errorf("script %s: %w", database, err)
		}
		for _, obj := range modules {
			if obj.Encrypted {
				res.SkippedEncrypted = append(res.SkippedEncrypted, database+"."+obj.Schema+"."+obj.Name)
				continue
			}
			subfolder, ok := typeSubfolder(obj.Type)
			if !ok {
				continue // not one of the scripted module types
			}
			rel := relPath(multiDB, database, subfolder, obj.Schema, obj.Name)
			abs := filepath.Join(folder, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				return nil, err
			}
			status, err := writeIfChanged(abs, obj.SQL)
			if err != nil {
				return nil, err
			}
			res.Files = append(res.Files, FileResult{Path: rel, Status: status})
		}
	}

	sort.Slice(res.Files, func(i, j int) bool {
		a, b := res.Files[i], res.Files[j]
		if statusRank[a.Status] != statusRank[b.Status] {
			return statusRank[a.Status] < statusRank[b.Status]
		}
		return a.Path < b.Path
	})
	return res, nil
}

// writeIfChanged writes content to abs unless the file already holds it
// byte-for-byte, reporting which of the three cases applied.
func writeIfChanged(abs, content string) (string, error) {
	existing, err := os.ReadFile(abs)
	if err == nil && string(existing) == content {
		return "unchanged", nil
	}
	status := "updated"
	if err != nil {
		status = "added"
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		return "", err
	}
	return status, nil
}
