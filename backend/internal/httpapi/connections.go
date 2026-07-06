package httpapi

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/conn"
)

// profileRequest is a Profile plus a write-only password field.
type profileRequest struct {
	conn.Profile
	Password string `json:"password,omitempty"`
}

func mountConnections(r chi.Router, d *Deps) {
	r.Route("/api/connections", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, d.Store.List())
		})

		r.Post("/", func(w http.ResponseWriter, req *http.Request) {
			var body profileRequest
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			p, err := d.Store.Create(body.Profile)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Password != "" {
				if err := conn.SetPassword(p.ID, body.Password); err != nil {
					_ = d.Store.Delete(p.ID)
					writeErr(w, http.StatusInternalServerError, fmt.Errorf("store credential: %w", err))
					return
				}
			}
			writeJSON(w, http.StatusOK, p)
		})

		r.Put("/{id}", func(w http.ResponseWriter, req *http.Request) {
			var body profileRequest
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			body.ID = chi.URLParam(req, "id")
			if err := d.Store.Update(body.Profile); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, conn.ErrNotFound) {
					status = http.StatusNotFound
				}
				writeErr(w, status, err)
				return
			}
			if body.Password != "" {
				if err := conn.SetPassword(body.ID, body.Password); err != nil {
					writeErr(w, http.StatusInternalServerError, fmt.Errorf("store credential: %w", err))
					return
				}
			}
			d.Registry.CloseProfile(body.ID)
			writeJSON(w, http.StatusOK, body.Profile)
		})

		r.Delete("/{id}", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "id")
			if err := d.Store.Delete(id); err != nil {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			_ = conn.DeletePassword(id)
			d.Registry.CloseProfile(id)
			writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
		})

		// Test a connection: either an existing profile ({id} + no body changes)
		// or unsaved dialog values (full profile in body).
		r.Post("/test", func(w http.ResponseWriter, req *http.Request) {
			var body profileRequest
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			version, err := conn.Test(req.Context(), body.Profile, body.Password)
			if err != nil {
				writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version})
		})
	})
}
