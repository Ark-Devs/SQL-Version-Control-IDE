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
				Ref          string   `json:"ref"`
				Paths        []string `json:"paths"`
				TargetConnID string   `json:"targetConnId"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Ref == "" || body.TargetConnID == "" {
				writeErr(w, http.StatusBadRequest, errors.New("ref and targetConnId are required"))
				return
			}
			plan, err := d.Planner.BuildPlan(body.Ref, body.Paths, body.TargetConnID)
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
			poolFor := func(database string) (*sql.DB, error) {
				return d.Registry.Get(plan.TargetConnID, database)
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
