package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func mountMeta(r chi.Router, d *Deps) {
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
