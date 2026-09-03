package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/settings"
)

// maxSessionBytes caps the saved workspace session. Generous — it holds the
// full text of every open query — but bounded so a runaway renderer cannot
// write an unbounded file.
const maxSessionBytes = 32 << 20

func mountMeta(r chi.Router, d *Deps) {
	r.Get("/api/settings", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, d.Settings.Get())
	})

	r.Put("/api/settings", func(w http.ResponseWriter, req *http.Request) {
		var s settings.Settings
		if err := decode(req, &s); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := d.Settings.Set(s); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, s)
	})

	// Workspace session: opaque renderer state (open tabs and their SQL, layout,
	// expanded explorer nodes, last repo) round-tripped verbatim.
	r.Get("/api/session", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, d.Session.Get())
	})

	r.Put("/api/session", func(w http.ResponseWriter, req *http.Request) {
		raw, err := io.ReadAll(io.LimitReader(req.Body, maxSessionBytes+1))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if len(raw) > maxSessionBytes {
			writeErr(w, http.StatusRequestEntityTooLarge, errors.New("session exceeds 32 MB"))
			return
		}
		if !json.Valid(raw) {
			writeErr(w, http.StatusBadRequest, errors.New("session body is not valid JSON"))
			return
		}
		if err := d.Session.Set(raw); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
	})

	r.Get("/api/meta/{connId}/{db}/autocomplete", func(w http.ResponseWriter, req *http.Request) {
		connID := chi.URLParam(req, "connId")
		database := chi.URLParam(req, "db")
		pool, err := d.Registry.Get(connID, database)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		refresh := req.URL.Query().Get("refresh") == "1"
		data, err := d.AcCache.Get(req.Context(), connID+"|"+database, pool, refresh)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, data)
	})
}
