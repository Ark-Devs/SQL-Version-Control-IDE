package httpapi

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/db"
)

func (d *Deps) poolFor(w http.ResponseWriter, req *http.Request) (*sql.DB, bool) {
	pool, err := d.Registry.Get(chi.URLParam(req, "connId"), chi.URLParam(req, "db"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return nil, false
	}
	return pool, true
}

func mountExplorer(r chi.Router, d *Deps) {
	r.Route("/api/explorer/{connId}", func(r chi.Router) {
		r.Get("/databases", func(w http.ResponseWriter, req *http.Request) {
			pool, err := d.Registry.Get(chi.URLParam(req, "connId"), "")
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			dbs, err := db.ListDatabases(req.Context(), pool)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, dbs)
		})

		r.Route("/{db}", func(r chi.Router) {
			r.Get("/objects", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				objs, err := db.ListObjects(req.Context(), pool)
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, objs)
			})

			r.Get("/tables/{schema}/{name}/columns", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				cols, err := db.ListColumns(req.Context(), pool, chi.URLParam(req, "schema"), chi.URLParam(req, "name"))
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, cols)
			})

			r.Get("/tables/{schema}/{name}/indexes", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				idx, err := db.ListIndexes(req.Context(), pool, chi.URLParam(req, "schema"), chi.URLParam(req, "name"))
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, idx)
			})

			r.Get("/extras", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				extras, err := db.LoadExtras(req.Context(), pool)
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, extras)
			})

			r.Get("/tables/{schema}/{name}/detail", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				detail, err := db.LoadTableDetail(req.Context(), pool, chi.URLParam(req, "schema"), chi.URLParam(req, "name"))
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, detail)
			})

			r.Get("/objects/{schema}/{name}/definition", func(w http.ResponseWriter, req *http.Request) {
				pool, ok := d.poolFor(w, req)
				if !ok {
					return
				}
				def, err := db.GetDefinition(req.Context(), pool, chi.URLParam(req, "schema"), chi.URLParam(req, "name"))
				if err != nil {
					writeErr(w, http.StatusInternalServerError, err)
					return
				}
				writeJSON(w, http.StatusOK, def)
			})
		})
	})
}
