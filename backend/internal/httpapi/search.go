package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"svcide/internal/db"
)

// excludedSearchDatabases are the system databases skipped when no explicit
// ?db= is given.
var excludedSearchDatabases = map[string]bool{
	"master": true, "tempdb": true, "model": true, "msdb": true,
}

func mountSearch(r chi.Router, d *Deps) {
	r.Get("/api/search/{connId}", func(w http.ResponseWriter, req *http.Request) {
		connID := chi.URLParam(req, "connId")
		q := strings.TrimSpace(req.URL.Query().Get("q"))
		if len([]rune(q)) < 2 {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("q must be at least 2 characters"))
			return
		}

		poolFor := func(database string) (*sql.DB, error) {
			return d.Registry.Get(connID, database)
		}

		var databases []string
		if database := req.URL.Query().Get("db"); database != "" {
			databases = []string{database}
		} else {
			masterPool, err := d.Registry.Get(connID, "")
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			dbs, err := db.ListDatabases(req.Context(), masterPool)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			for _, di := range dbs {
				if excludedSearchDatabases[strings.ToLower(di.Name)] {
					continue
				}
				databases = append(databases, di.Name)
			}
		}

		result, err := db.Search(req.Context(), poolFor, databases, q, 200)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
}
