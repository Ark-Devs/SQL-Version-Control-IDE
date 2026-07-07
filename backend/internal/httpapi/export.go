package httpapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/export"
)

func mountExport(r chi.Router, d *Deps) {
	r.Post("/api/export", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Folder    string   `json:"folder"`
			ConnID    string   `json:"connId"`
			Databases []string `json:"databases"`
		}
		if err := decode(req, &body); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if body.Folder == "" {
			writeErr(w, http.StatusBadRequest, errors.New("folder is required"))
			return
		}
		if len(body.Databases) == 0 {
			writeErr(w, http.StatusBadRequest, errors.New("at least one database is required"))
			return
		}

		poolFor := func(database string) (*sql.DB, error) {
			return d.Registry.Get(body.ConnID, database)
		}
		res, err := export.Run(req.Context(), body.Folder, body.Databases, poolFor)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
}
