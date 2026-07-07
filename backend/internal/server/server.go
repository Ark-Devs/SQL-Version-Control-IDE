package server

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"

	"svcide/internal/conn"
	"svcide/internal/db"
	"svcide/internal/deploy"
	"svcide/internal/gitrepo"
	"svcide/internal/httpapi"
	"svcide/internal/settings"
)

// New builds the API router. Closing shutdownCh (via /api/shutdown) tells
// main to stop the HTTP server.
func New(token string, shutdownCh chan struct{}) (http.Handler, error) {
	store, err := conn.NewStore()
	if err != nil {
		return nil, fmt.Errorf("init profile store: %w", err)
	}
	settingsStore, err := settings.NewStore()
	if err != nil {
		return nil, fmt.Errorf("init settings store: %w", err)
	}
	repo := gitrepo.NewManager()
	deps := &httpapi.Deps{
		Store:    store,
		Registry: conn.NewRegistry(store),
		Execs:    db.NewManager(),
		Repo:     repo,
		Planner:  deploy.NewPlanner(repo),
		AcCache:  db.NewAcCache(),
		Settings: settingsStore,
	}

	r := chi.NewRouter()
	r.Use(bearerAuth(token))

	r.Get("/api/meta/health", func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": "0.1.2"})
	})

	httpapi.Mount(r, deps)

	var once sync.Once
	r.Post("/api/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"status": "shutting down"})
		once.Do(func() { close(shutdownCh) })
	})

	return r, nil
}

func bearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			got, ok := strings.CutPrefix(auth, "Bearer ")
			if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
				WriteError(w, http.StatusUnauthorized, "invalid or missing token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// WriteJSON writes v as a JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a JSON error payload.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}
