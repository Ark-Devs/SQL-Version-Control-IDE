package httpapi

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"svcide/internal/deploy"
)

func mountDeploy(r chi.Router, d *Deps) {
	r.Route("/api/deploy", func(r chi.Router) {
		r.Post("/plan", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Ref          string            `json:"ref"`
				Paths        []string          `json:"paths"`
				TargetConnID string            `json:"targetConnId"`
				Targets      map[string]string `json:"targets"` // alias → connection profile ID
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Ref == "" {
				writeErr(w, http.StatusBadRequest, errors.New("ref is required"))
				return
			}
			// one target connection for the whole plan, per-source targets, or both
			if body.TargetConnID == "" && len(body.Targets) == 0 {
				writeErr(w, http.StatusBadRequest, errors.New("targetConnId or targets is required"))
				return
			}
			plan, err := d.Planner.BuildPlan(body.Ref, body.Paths, body.TargetConnID, body.Targets)
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, plan)
		})

		r.Post("/{planId}/execute", func(w http.ResponseWriter, req *http.Request) {
			plan, ok := d.Planner.Get(chi.URLParam(req, "planId"))
			if !ok {
				writeErr(w, http.StatusNotFound, fmt.Errorf("plan not found or expired"))
				return
			}
			// The alias picks the connection (sources may live on different
			// servers); the database name picks the catalog on it. Falling back
			// to TargetConnID keeps "deploy this branch to staging" working,
			// where every source lands on one connection.
			poolFor := func(alias, database string) (*sql.DB, error) {
				connID := plan.Targets[alias]
				if connID == "" {
					connID = plan.TargetConnID
				}
				if connID == "" {
					return nil, fmt.Errorf("no connection bound to source %q", alias)
				}
				return d.Registry.Get(connID, database)
			}
			res, err := deploy.Execute(req.Context(), poolFor, plan)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			d.Planner.Release(plan.ID)
			writeJSON(w, http.StatusOK, res)
		})
	})
}
