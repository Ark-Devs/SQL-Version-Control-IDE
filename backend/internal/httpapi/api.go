package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/conn"
	"svcide/internal/db"
	"svcide/internal/deploy"
	"svcide/internal/gitrepo"
	"svcide/internal/settings"
)

// Deps carries shared services into the HTTP handlers.
type Deps struct {
	Store    *conn.Store
	Registry *conn.Registry
	Execs    *db.Manager
	Repo     *gitrepo.Manager
	Planner  *deploy.Planner
	AcCache  *db.AcCache
	Settings *settings.Store
	Session  *settings.SessionStore
}

// Mount attaches all API routes under /api.
func Mount(r chi.Router, d *Deps) {
	mountConnections(r, d)
	mountExplorer(r, d)
	mountQuery(r, d)
	mountVCS(r, d)
	mountDeploy(r, d)
	mountMeta(r, d)
	mountRemote(r, d)
	mountExport(r, d)
	mountGitHub(r, d)
	mountSearch(r, d)
	mountUpdates(r, d)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func decode(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
