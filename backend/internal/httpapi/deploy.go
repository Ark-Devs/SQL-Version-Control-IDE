package httpapi

import (
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
				TargetDB     string   `json:"targetDb"`
			}
			if err := decode(req, &body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if body.Ref == "" || body.TargetConnID == "" || body.TargetDB == "" {
				writeErr(w, http.StatusBadRequest, errors.New("ref, targetConnId and targetDb are required"))
				return
			}
			plan, err := d.Planner.BuildPlan(body.Ref, body.Paths, body.TargetConnID, body.TargetDB)
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
			pool, err := d.Registry.Get(plan.TargetConnID, plan.TargetDB)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			res, err := deploy.Execute(req.Context(), pool, plan)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			d.Planner.Release(plan.ID)
			writeJSON(w, http.StatusOK, res)
		})
	})
}
