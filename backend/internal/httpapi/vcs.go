package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"svcide/internal/db"
	"svcide/internal/gitrepo"
)

func mountVCS(r chi.Router, d *Deps) {
	r.Route("/api/repo", func(r chi.Router) {
		r.Post("/init", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Path    string          `json:"path"`
				Sources []sourceRequest `json:"sources"`

				// Pre multi-source shape: one connection, N databases.
				ConnID    string   `json:"connId"`
				Databases []string `json:"databases"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if len(body.Sources) == 0 {
				for _, database := range body.Databases {
					body.Sources = append(body.Sources, sourceRequest{ConnID: body.ConnID, Database: database})
				}
			}
			if len(body.Sources) == 0 {
				writeErr(w, http.StatusBadRequest, errors.New("at least one source is required"))
				return
			}
			// Resolve every source before touching disk, so a bad connection ID
			// doesn't leave an empty repository behind.
			var sources []gitrepo.Source
			bindings := map[string]string{}
			taken := map[string]bool{}
			for _, s := range body.Sources {
				src, err := resolveSource(d, s, taken)
				if err != nil {
					writeErr(w, http.StatusBadRequest, err)
					return
				}
				sources = append(sources, src)
				bindings[src.Alias] = s.ConnID
				taken[strings.ToLower(src.Alias)] = true
			}
			if err := d.Repo.Init(body.Path); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			man := &gitrepo.Manifest{Sources: sources, Objects: map[string]gitrepo.ManifestObject{}}
			if err := d.Repo.WriteManifest(man); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			if err := d.Bindings.SetAll(d.Repo.Path(), bindings); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			if _, err := d.Repo.Commit("Initialize repository", nil); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			repoInfo(w, d, nil)
		})

		r.Post("/open", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Path string `json:"path"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			migrated, err := d.Repo.Open(body.Path)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if err := autoBind(d); err != nil {
				writeErr(w, http.StatusInternalServerError, fmt.Errorf("bind repository sources: %w", err))
				return
			}
			repoInfo(w, d, map[string]any{"migratedLayout": migrated})
		})

		// Sources tracked by the open repository, with their machine-local
		// connection bindings. Add/remove let a database join or leave an
		// existing repo — at init is not the only time that decision is made.
		r.Get("/sources", func(w http.ResponseWriter, _ *http.Request) {
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"sources":  man.Sources,
				"bindings": d.Bindings.Get(d.Repo.Path()),
			})
		})

		// Adding a source only records it; the objects arrive on the next sync.
		// The manifest change is left uncommitted for review in the Git panel.
		r.Post("/sources", func(w http.ResponseWriter, req *http.Request) {
			var s sourceRequest
			if err := decode(req, &s); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			taken := map[string]bool{}
			for _, existing := range man.Sources {
				taken[strings.ToLower(existing.Alias)] = true
			}
			src, err := resolveSource(d, s, taken)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			man.Sources = append(man.Sources, src)
			if err := d.Repo.WriteManifest(man); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			if err := d.Bindings.Bind(d.Repo.Path(), src.Alias, s.ConnID); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			repoInfo(w, d, nil)
		})

		// Removing a source drops its manifest entries and its scripted files,
		// leaving the deletions staged in the worktree for the user to commit.
		r.Delete("/sources", func(w http.ResponseWriter, req *http.Request) {
			alias := req.URL.Query().Get("alias")
			if alias == "" {
				writeErr(w, http.StatusBadRequest, errors.New("alias is required"))
				return
			}
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			src, ok := man.SourceByAlias(alias)
			if !ok {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("source %q is not tracked by this repository", alias))
				return
			}
			kept := make([]gitrepo.Source, 0, len(man.Sources))
			for _, s := range man.Sources {
				if !strings.EqualFold(s.Alias, src.Alias) {
					kept = append(kept, s)
				}
			}
			man.Sources = kept
			removeSourceFiles(d.Repo.Path(), man, src.Alias)
			if err := d.Repo.WriteManifest(man); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			remaining := d.Bindings.Get(d.Repo.Path())
			for a := range remaining {
				if strings.EqualFold(a, src.Alias) {
					delete(remaining, a)
				}
			}
			if err := d.Bindings.SetAll(d.Repo.Path(), remaining); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			repoInfo(w, d, nil)
		})

		r.Get("/info", func(w http.ResponseWriter, _ *http.Request) {
			if !d.Repo.IsOpen() {
				writeJSON(w, http.StatusOK, map[string]any{"open": false})
				return
			}
			repoInfo(w, d, nil)
		})

		r.Post("/sync", func(w http.ResponseWriter, req *http.Request) {
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			res, err := d.Repo.Sync(req.Context(), repoPoolFunc(d, man), man)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		// Sync one object (the "live mirror"): after the user runs DDL, re-script
		// that single object from the database into the worktree so git status/diff
		// immediately reflects the change. No-ops safely (200 skipped) when no repo
		// is open or the database isn't tracked by the manifest.
		r.Post("/sync-object", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				ConnID   string `json:"connId"`
				Database string `json:"database"`
				Schema   string `json:"schema"`
				Name     string `json:"name"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Database == "" || body.Name == "" {
				writeErr(w, http.StatusBadRequest, errors.New("database and name are required"))
				return
			}
			if body.Schema == "" {
				body.Schema = "dbo"
			}
			if !d.Repo.IsOpen() {
				writeJSON(w, http.StatusOK, map[string]any{"skipped": true, "reason": "no repository open"})
				return
			}
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			src, ok := sourceForConn(d, man, body.ConnID, body.Database)
			if !ok {
				writeJSON(w, http.StatusOK, map[string]any{"skipped": true, "reason": "database is not tracked by this repository on this connection"})
				return
			}
			connID, ok := d.Bindings.ConnID(d.Repo.Path(), src.Alias)
			if !ok {
				writeJSON(w, http.StatusOK, map[string]any{"skipped": true, "reason": fmt.Sprintf("source %q is not bound to a connection on this machine", src.Alias)})
				return
			}
			pool, err := d.Registry.Get(connID, src.Database)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			// try a programmable module first, then a table; nil ⇒ dropped object
			obj, err := db.ScriptModule(req.Context(), pool, body.Schema, body.Name)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			if obj == nil {
				obj, err = db.ScriptTable(req.Context(), pool, body.Schema, body.Name)
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
			}
			res, err := d.Repo.SyncObject(src, body.Schema, body.Name, obj, man)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		// Drift: compare one database against the repo without writing.
		// Powers the green (new) / yellow (modified) explorer badges.
		r.Get("/drift/{connId}/{db}", func(w http.ResponseWriter, req *http.Request) {
			connID, database := chi.URLParam(req, "connId"), chi.URLParam(req, "db")
			// Drift compares against the repo baseline, so it only means
			// anything for the exact source the manifest tracks — matching on
			// the database name alone would report drift for another server's
			// database that merely shares the name.
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			src, ok := sourceForConn(d, man, connID, database)
			if !ok {
				writeJSON(w, http.StatusOK, gitrepo.DriftReport{})
				return
			}
			pool, err := d.Registry.Get(connID, src.Database)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			report, err := d.Repo.Drift(req.Context(), pool, src.Alias)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, report)
		})

		r.Get("/changes", func(w http.ResponseWriter, _ *http.Request) {
			st, err := d.Repo.Status()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, st)
		})

		// Object status: per-object VC state (added/modified/deleted) derived
		// from the git worktree status + manifest. Powers the M/A/D badges and
		// deleted-object ghost rows in the explorer, distinct from /drift (which
		// compares the live DB against the repo baseline before a sync).
		r.Get("/object-status", func(w http.ResponseWriter, _ *http.Request) {
			if !d.Repo.IsOpen() {
				writeJSON(w, http.StatusOK, map[string]any{"objects": map[string]any{}})
				return
			}
			objs, err := d.Repo.ObjectStatus()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"objects": objs})
		})

		r.Post("/commit", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Message string   `json:"message"`
				Paths   []string `json:"paths"`
			}
			if err := decode(req, &body); err != nil || body.Message == "" {
				writeErr(w, http.StatusBadRequest, errors.New("commit message is required"))
				return
			}
			hash, err := d.Repo.Commit(body.Message, body.Paths)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"hash": hash})
		})

		r.Post("/discard", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Paths []string `json:"paths"`
			}
			if err := decode(req, &body); err != nil || len(body.Paths) == 0 {
				writeErr(w, http.StatusBadRequest, errors.New("paths are required"))
				return
			}
			if err := d.Repo.Discard(body.Paths); err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"discarded": true})
		})

		r.Get("/branches", func(w http.ResponseWriter, _ *http.Request) {
			branches, err := d.Repo.Branches()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, branches)
		})

		r.Post("/branches", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Name string `json:"name"`
				From string `json:"from"`
			}
			if err := decode(req, &body); err != nil || body.Name == "" {
				writeErr(w, http.StatusBadRequest, errors.New("branch name is required"))
				return
			}
			if err := d.Repo.CreateBranch(body.Name, body.From); err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"created": true})
		})

		r.Post("/checkout", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Name string `json:"name"`
			}
			if err := decode(req, &body); err != nil || body.Name == "" {
				writeErr(w, http.StatusBadRequest, errors.New("branch name is required"))
				return
			}
			if err := d.Repo.Checkout(body.Name); err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			repoInfo(w, d, nil)
		})

		r.Post("/merge", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				From string `json:"from"`
			}
			if err := decode(req, &body); err != nil || body.From == "" {
				writeErr(w, http.StatusBadRequest, errors.New("source branch is required"))
				return
			}
			res, err := d.Repo.Merge(body.From)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		r.Post("/merge/resolve", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Resolutions map[string]string `json:"resolutions"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			res, err := d.Repo.Resolve(body.Resolutions)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		r.Post("/merge/abort", func(w http.ResponseWriter, _ *http.Request) {
			d.Repo.AbortMerge()
			writeJSON(w, http.StatusOK, map[string]bool{"aborted": true})
		})

		r.Get("/log", func(w http.ResponseWriter, req *http.Request) {
			limit, _ := strconv.Atoi(req.URL.Query().Get("limit"))
			entries, err := d.Repo.Log(req.URL.Query().Get("path"), limit)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, entries)
		})

		// Schema compare: diff the repo (at a ref) against a live target
		// connection, scripting the target's objects in memory. Powers the
		// Compare tab and its deploy-selected flow.
		r.Post("/compare", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Ref          string   `json:"ref"`
				TargetConnID string   `json:"targetConnId"`
				Aliases      []string `json:"aliases"`
				// Pre multi-source shape: names that were both alias and database.
				Databases []string `json:"databases"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Ref == "" {
				body.Ref = "HEAD"
			}
			if len(body.Aliases) == 0 {
				body.Aliases = body.Databases
			}
			if !d.Repo.IsOpen() {
				writeErr(w, http.StatusBadRequest, gitrepo.ErrNoRepo)
				return
			}
			// Compare reads the repo side at ref, so aliases resolve against the
			// manifest at that ref too — a source may have been added since.
			refMan, err := d.Repo.ManifestAtRef(body.Ref)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			var poolFor gitrepo.PoolFunc
			if body.TargetConnID != "" {
				// Every alias is scripted from the one target connection the user
				// picked: compare answers "what would deploying here change?".
				poolFor = func(alias string) (*sql.DB, error) {
					src, ok := refMan.SourceByAlias(alias)
					if !ok {
						return nil, fmt.Errorf("source %q is not tracked at %s", alias, body.Ref)
					}
					return d.Registry.Get(body.TargetConnID, src.Database)
				}
			} else {
				// No explicit target: compare against each source's own bound
				// database — "what would checking out this branch change?".
				poolFor = repoPoolFunc(d, refMan)
			}
			res, err := d.Repo.Compare(req.Context(), poolFor, body.Ref, body.Aliases)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, slimCompare(res))
		})

		r.Get("/file", func(w http.ResponseWriter, req *http.Request) {
			path := req.URL.Query().Get("path")
			ref := req.URL.Query().Get("ref")
			if path == "" || ref == "" {
				writeErr(w, http.StatusBadRequest, errors.New("path and ref are required"))
				return
			}
			content, err := d.Repo.FileAtRef(path, ref)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"content": content})
		})
	})

	// Serve one object's SQL bodies from a cached compare result. The compare
	// list responses are metadata-only (full SQL for every object of a large
	// database in one payload can exhaust the renderer), so the diff viewer
	// fetches the two sides lazily per object.
	r.Get("/api/compare/{id}/object", func(w http.ResponseWriter, req *http.Request) {
		repoSql, targetSql, ok := compares.sql(chi.URLParam(req, "id"), req.URL.Query().Get("path"))
		if !ok {
			writeErr(w, http.StatusNotFound, errors.New("compare result expired — run the compare again"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"repoSql": repoSql, "targetSql": targetSql})
	})

	// Live schema compare: diff two live databases directly, no repository
	// required — works in standalone mode. "missingOnTarget" in the result
	// means "present on the source only".
	r.Post("/api/compare/live", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			SourceConnID string `json:"sourceConnId"`
			SourceDb     string `json:"sourceDb"`
			TargetConnID string `json:"targetConnId"`
			TargetDb     string `json:"targetDb"`
		}
		if err := decode(req, &body); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if body.SourceConnID == "" || body.SourceDb == "" || body.TargetConnID == "" || body.TargetDb == "" {
			writeErr(w, http.StatusBadRequest, errors.New("sourceConnId, sourceDb, targetConnId and targetDb are required"))
			return
		}
		sourcePool, err := d.Registry.Get(body.SourceConnID, body.SourceDb)
		if err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("source: %w", err))
			return
		}
		targetPool, err := d.Registry.Get(body.TargetConnID, body.TargetDb)
		if err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("target: %w", err))
			return
		}
		res, err := gitrepo.LiveCompare(req.Context(), sourcePool, targetPool, body.SourceDb)
		if err != nil {
			writeErr(w, statusFor(err), err)
			return
		}
		writeJSON(w, http.StatusOK, slimCompare(res))
	})
}

// compareCache keeps the last few full compare results in memory so the diff
// viewer can pull individual objects' SQL after a metadata-only list response.
type compareCache struct {
	mu    sync.Mutex
	order []string
	items map[string]*gitrepo.CompareResult
}

var compares compareCache

func (c *compareCache) put(res *gitrepo.CompareResult) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = map[string]*gitrepo.CompareResult{}
	}
	id := uuid.NewString()
	c.items[id] = res
	c.order = append(c.order, id)
	for len(c.order) > 4 {
		delete(c.items, c.order[0])
		c.order = c.order[1:]
	}
	return id
}

func (c *compareCache) sql(id, path string) (repoSql, targetSql string, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	res := c.items[id]
	if res == nil {
		return "", "", false
	}
	for _, o := range res.Objects {
		if o.Path == path {
			return o.RepoSQL, o.TargetSQL, true
		}
	}
	return "", "", false
}

// slimCompare caches the full result and returns a metadata-only copy plus the
// cache id. Shipping every object's SQL in one payload can be tens/hundreds of
// MB on a large database and crashes the renderer.
func slimCompare(res *gitrepo.CompareResult) map[string]any {
	id := compares.put(res)
	objects := make([]gitrepo.CompareObject, len(res.Objects))
	for i, o := range res.Objects {
		o.RepoSQL, o.TargetSQL = "", ""
		objects[i] = o
	}
	return map[string]any{"id": id, "objects": objects, "warnings": res.Warnings}
}

func repoInfo(w http.ResponseWriter, d *Deps, extra map[string]any) {
	branch, _ := d.Repo.CurrentBranch()
	man, _ := d.Repo.ReadManifest()
	bindings := d.Bindings.Get(d.Repo.Path())

	// databases/sourceConnId/sourceServer are derived, not stored: the manifest
	// no longer carries a connection and a repo can span servers. They are
	// emitted — including inside "manifest", where the current renderer looks
	// for them — so a single-source workspace keeps working unchanged.
	var (
		databases  []string
		connID     string
		server     string
		manifestJS any
	)
	if man != nil {
		databases = man.DatabaseNames()
		if len(man.Sources) > 0 {
			first := man.Sources[0]
			server = first.Server
			connID, _ = d.Bindings.ConnID(d.Repo.Path(), first.Alias)
		}
		manifestJS = map[string]any{
			"sources":      man.Sources,
			"objects":      man.Objects,
			"databases":    databases,
			"sourceConnId": connID,
			"sourceServer": server,
		}
	}

	resp := map[string]any{
		"open":            true,
		"path":            d.Repo.Path(),
		"branch":          branch,
		"manifest":        manifestJS,
		"sqlFolderExists": d.Repo.SQLFolderExists(),
		"databases":       databases,
		"sourceConnId":    connID,
		"bindings":        bindings,
	}
	for k, v := range extra {
		resp[k] = v
	}
	writeJSON(w, http.StatusOK, resp)
}

// sourceRequest is one database a repo should track, as the client names it:
// a local connection plus a database, with an optional repo-side alias.
type sourceRequest struct {
	Alias    string `json:"alias"`
	ConnID   string `json:"connId"`
	Database string `json:"database"`
}

// resolveSource turns a request into a manifest Source, recording the server
// from the local profile. taken holds the lowercased aliases already in use.
func resolveSource(d *Deps, s sourceRequest, taken map[string]bool) (gitrepo.Source, error) {
	if s.Database == "" {
		return gitrepo.Source{}, errors.New("database is required for every source")
	}
	profile, err := d.Store.Get(s.ConnID)
	if err != nil {
		return gitrepo.Source{}, fmt.Errorf("source %s: %w", s.Database, err)
	}
	alias := s.Alias
	if alias == "" {
		alias = uniqueAlias(s.Database, profile.Server, taken)
	}
	if taken[strings.ToLower(alias)] {
		return gitrepo.Source{}, fmt.Errorf("alias %q is already used by another source", alias)
	}
	return gitrepo.Source{Alias: alias, Database: s.Database, Server: profile.Server}, nil
}

// uniqueAlias names a source's tree under SQL/. The database name is used
// as-is; when a second source claims the same name — the point of aliases,
// since two servers can each host a "Hospital" — the server disambiguates.
func uniqueAlias(database, server string, taken map[string]bool) string {
	if !taken[strings.ToLower(database)] {
		return database
	}
	base := database + "@" + serverToken(server)
	alias := base
	for i := 2; taken[strings.ToLower(alias)]; i++ {
		alias = fmt.Sprintf("%s-%d", base, i)
	}
	return alias
}

// serverToken reduces a server address to a folder-friendly token:
// `sql01\dev,1433` → `sql01-dev`.
func serverToken(server string) string {
	token := server
	if i := strings.IndexAny(token, ",;"); i >= 0 {
		token = token[:i]
	}
	token = strings.Trim(strings.NewReplacer(`\`, "-", "/", "-", ":", "-").Replace(token), "-")
	if token == "" {
		return "server"
	}
	return token
}

// sourceForConn resolves a live (connection, database) pair to the manifest
// source it belongs to. The binding is what makes the answer specific: two
// servers can both host a "Hospital", and only one of them is this repo's. An
// empty connID means the caller didn't say which connection (the pre
// multi-source request shape), so the database name alone decides.
func sourceForConn(d *Deps, man *gitrepo.Manifest, connID, database string) (gitrepo.Source, bool) {
	for _, src := range man.Sources {
		if !strings.EqualFold(src.Database, database) {
			continue
		}
		// The binding is what disambiguates: two sources can share a database
		// name on different servers, so the name alone never identifies one.
		if bound, ok := d.Bindings.ConnID(d.Repo.Path(), src.Alias); ok && bound == connID {
			return src, true
		}
	}
	return gitrepo.Source{}, false
}

// repoPoolFunc resolves a source alias to a pool through the machine-local
// binding, which is what lets each source sit on a different server.
func repoPoolFunc(d *Deps, man *gitrepo.Manifest) gitrepo.PoolFunc {
	repoPath := d.Repo.Path()
	return func(alias string) (*sql.DB, error) {
		src, ok := man.SourceByAlias(alias)
		if !ok {
			return nil, fmt.Errorf("source %q is not tracked by this repository", alias)
		}
		connID, ok := d.Bindings.ConnID(repoPath, alias)
		if !ok {
			return nil, fmt.Errorf("source %q is not bound to a connection on this machine", alias)
		}
		return d.Registry.Get(connID, src.Database)
	}
}

// autoBind fills in missing alias→connection bindings after a repo is opened.
// A repo cloned from a teammate carries sources but no bindings, so each source
// is matched to a saved profile on the same server; a manifest migrated from
// the pre multi-source shape names the profile it was synced from, which beats
// guessing. Done here rather than in gitrepo to keep the repo layer free of any
// connection-profile dependency.
func autoBind(d *Deps) error {
	man, err := d.Repo.ReadManifest()
	if err != nil {
		return err
	}
	repoPath := d.Repo.Path()
	profiles := d.Store.List()
	for _, src := range man.Sources {
		if _, bound := d.Bindings.ConnID(repoPath, src.Alias); bound {
			continue
		}
		connID := ""
		if man.LegacyConnID != "" {
			if _, err := d.Store.Get(man.LegacyConnID); err == nil {
				connID = man.LegacyConnID
			}
		}
		if connID == "" && src.Server != "" {
			for _, p := range profiles {
				if strings.EqualFold(p.Server, src.Server) {
					connID = p.ID
					break
				}
			}
		}
		if connID == "" {
			continue // no match on this machine; the user binds it explicitly
		}
		if err := d.Bindings.Bind(repoPath, src.Alias, connID); err != nil {
			return err
		}
	}
	return nil
}

// removeSourceFiles deletes the worktree files of one source, drops its
// manifest entries, and prunes the directories that empty out. os.Remove on a
// directory only succeeds when it is empty, so a shared parent survives.
func removeSourceFiles(root string, man *gitrepo.Manifest, alias string) {
	var dirs []string
	for path, obj := range man.Objects {
		if !strings.EqualFold(obj.SourceAlias(), alias) {
			continue
		}
		abs := filepath.Join(root, filepath.FromSlash(path))
		_ = os.Remove(abs)
		delete(man.Objects, path)
		for dir := filepath.Dir(abs); len(dir) > len(root); dir = filepath.Dir(dir) {
			dirs = append(dirs, dir)
		}
	}
	// deepest first, so a parent is empty by the time we reach it
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	for _, dir := range dirs {
		_ = os.Remove(dir)
	}
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, gitrepo.ErrNoRepo):
		return http.StatusBadRequest
	case errors.Is(err, gitrepo.ErrDirtyWorktree):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}
