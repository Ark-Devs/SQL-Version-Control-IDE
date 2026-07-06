package httpapi

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type executeRequest struct {
	ConnID   string `json:"connId"`
	Database string `json:"database"`
	SQL      string `json:"sql"`
}

func mountQuery(r chi.Router, d *Deps) {
	r.Route("/api/query", func(r chi.Router) {
		r.Post("/execute", func(w http.ResponseWriter, req *http.Request) {
			var body executeRequest
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.SQL == "" {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("sql is required"))
				return
			}
			pool, err := d.Registry.Get(body.ConnID, body.Database)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			id := d.Execs.Start(pool, body.SQL)
			writeJSON(w, http.StatusOK, map[string]string{"executionId": id})
		})

		r.Get("/{id}/results", func(w http.ResponseWriter, req *http.Request) {
			snap, ok := d.Execs.Snapshot(chi.URLParam(req, "id"))
			if !ok {
				writeErr(w, http.StatusNotFound, fmt.Errorf("execution not found"))
				return
			}
			writeJSON(w, http.StatusOK, snap)
		})

		r.Post("/{id}/cancel", func(w http.ResponseWriter, req *http.Request) {
			if !d.Execs.Cancel(chi.URLParam(req, "id")) {
				writeErr(w, http.StatusNotFound, fmt.Errorf("execution not found"))
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"cancelled": true})
		})

		r.Post("/{id}/release", func(w http.ResponseWriter, req *http.Request) {
			d.Execs.Release(chi.URLParam(req, "id"))
			writeJSON(w, http.StatusOK, map[string]bool{"released": true})
		})
	})
}
