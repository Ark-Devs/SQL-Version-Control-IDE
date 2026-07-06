package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"svcide/internal/gitrepo"
)

func mountVCS(r chi.Router, d *Deps) {
	r.Route("/api/repo", func(r chi.Router) {
		r.Post("/init", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Path     string `json:"path"`
				ConnID   string `json:"connId"`
				Database string `json:"database"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
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
				SourceServer:   profile.Server,
				SourceDatabase: body.Database,
				SourceConnID:   body.ConnID,
				Objects:        map[string]gitrepo.ManifestObject{},
			}
			if err := d.Repo.WriteManifest(man); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			if _, err := d.Repo.Commit("Initialize repository", nil); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			repoInfo(w, d)
		})

		r.Post("/open", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Path string `json:"path"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if err := d.Repo.Open(body.Path); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			repoInfo(w, d)
		})

		r.Get("/info", func(w http.ResponseWriter, _ *http.Request) {
			if !d.Repo.IsOpen() {
				writeJSON(w, http.StatusOK, map[string]any{"open": false})
				return
			}
			repoInfo(w, d)
		})

		r.Post("/sync", func(w http.ResponseWriter, req *http.Request) {
			man, err := d.Repo.ReadManifest()
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			var body struct {
				ConnID   string `json:"connId"`
				Database string `json:"database"`
			}
			_ = decode(req, &body) // optional override of the manifest source
			connID, database := man.SourceConnID, man.SourceDatabase
			if body.ConnID != "" {
				connID = body.ConnID
			}
			if body.Database != "" {
				database = body.Database
			}
			pool, err := d.Registry.Get(connID, database)
			if err != nil {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("source connection: %w", err))
				return
			}
			res, err := d.Repo.Sync(req.Context(), pool, man)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, res)
		})

		r.Get("/changes", func(w http.ResponseWriter, _ *http.Request) {
			st, err := d.Repo.Status()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, st)
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
			repoInfo(w, d)
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
}

func repoInfo(w http.ResponseWriter, d *Deps) {
	branch, _ := d.Repo.CurrentBranch()
	man, _ := d.Repo.ReadManifest()
	writeJSON(w, http.StatusOK, map[string]any{
		"open":     true,
		"path":     d.Repo.Path(),
		"branch":   branch,
		"manifest": man,
	})
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
