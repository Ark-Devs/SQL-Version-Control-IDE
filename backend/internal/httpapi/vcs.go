package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"svcide/internal/db"
	"svcide/internal/gitrepo"
)

func mountVCS(r chi.Router, d *Deps) {
	r.Route("/api/repo", func(r chi.Router) {
		r.Post("/init", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Path      string   `json:"path"`
				ConnID    string   `json:"connId"`
				Databases []string `json:"databases"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if len(body.Databases) == 0 {
				writeErr(w, http.StatusBadRequest, errors.New("at least one database is required"))
				return
			}
			if err := d.Repo.Init(body.Path); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			profile, err := d.Store.Get(body.ConnID)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			man := &gitrepo.Manifest{
				SourceServer: profile.Server,
				SourceConnID: body.ConnID,
				Databases:    body.Databases,
				Objects:      map[string]gitrepo.ManifestObject{},
			}
			if err := d.Repo.WriteManifest(man); err != nil {
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
			repoInfo(w, d, map[string]any{"migratedLayout": migrated})
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
			var body struct {
				ConnID string `json:"connId"`
			}
			_ = decode(req, &body) // optional override of the manifest source
			connID := man.SourceConnID
			if body.ConnID != "" {
				connID = body.ConnID
			}
			poolFor := func(database string) (*sql.DB, error) {
				return d.Registry.Get(connID, database)
			}
			res, err := d.Repo.Sync(req.Context(), poolFor, man)
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
			tracked := false
			for _, name := range man.Databases {
				if strings.EqualFold(name, body.Database) {
					tracked = true
					break
				}
			}
			if !tracked {
				writeJSON(w, http.StatusOK, map[string]any{"skipped": true, "reason": "database not tracked by repository"})
				return
			}
			pool, err := d.Registry.Get(man.SourceConnID, body.Database)
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
			res, err := d.Repo.SyncObject(body.Database, body.Schema, body.Name, obj, man)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		// Drift: compare one database against the repo without writing.
		// Powers the green (new) / yellow (modified) explorer badges.
		r.Get("/drift/{connId}/{db}", func(w http.ResponseWriter, req *http.Request) {
			db := chi.URLParam(req, "db")
			// Drift compares against the repo baseline, so it only means
			// anything for databases the manifest tracks — an untracked
			// database has no files and every object would falsely report
			// as new/modified.
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			tracked := false
			for _, name := range man.Databases {
				if strings.EqualFold(name, db) {
					tracked = true
					break
				}
			}
			if !tracked {
				writeJSON(w, http.StatusOK, gitrepo.DriftReport{})
				return
			}
			pool, err := d.Registry.Get(chi.URLParam(req, "connId"), db)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			report, err := d.Repo.Drift(req.Context(), pool, db)
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
				Databases    []string `json:"databases"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Ref == "" {
				body.Ref = "HEAD"
			}
			if body.TargetConnID == "" {
				writeErr(w, http.StatusBadRequest, errors.New("targetConnId is required"))
				return
			}
			if !d.Repo.IsOpen() {
				writeErr(w, http.StatusBadRequest, gitrepo.ErrNoRepo)
				return
			}
			poolFor := func(database string) (*sql.DB, error) {
				return d.Registry.Get(body.TargetConnID, database)
			}
			res, err := d.Repo.Compare(req.Context(), poolFor, body.Ref, body.Databases)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, res)
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
		writeJSON(w, http.StatusOK, res)
	})
}

func repoInfo(w http.ResponseWriter, d *Deps, extra map[string]any) {
	branch, _ := d.Repo.CurrentBranch()
	man, _ := d.Repo.ReadManifest()
	var databases []string
	if man != nil {
		databases = man.Databases
	}
	resp := map[string]any{
		"open":            true,
		"path":            d.Repo.Path(),
		"branch":          branch,
		"manifest":        man,
		"sqlFolderExists": d.Repo.SQLFolderExists(),
		"databases":       databases,
	}
	for k, v := range extra {
		resp[k] = v
	}
	writeJSON(w, http.StatusOK, resp)
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
