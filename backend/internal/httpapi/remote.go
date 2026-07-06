package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func mountRemote(r chi.Router, d *Deps) {
	r.Route("/api/repo/remotes", func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			remotes, err := d.Repo.Remotes()
			if err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, remotes)
		})

		r.Post("/", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				Name string `json:"name"`
				URL  string `json:"url"`
			}
			if err := decode(req, &body); err != nil || body.URL == "" {
				writeErr(w, http.StatusBadRequest, errors.New("url is required"))
				return
			}
			if body.Name == "" {
				body.Name = "origin"
			}
			if err := d.Repo.SetRemote(body.Name, body.URL); err != nil {
				writeErr(w, statusFor(err), err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
		})
	})

	type remoteOp struct {
		Remote string `json:"remote"`
		Token  string `json:"token"`
	}
	readOp := func(req *http.Request) remoteOp {
		var body remoteOp
		_ = decode(req, &body)
		if body.Remote == "" {
			body.Remote = "origin"
		}
		return body
	}

	r.Post("/api/repo/push", func(w http.ResponseWriter, req *http.Request) {
		op := readOp(req)
		if err := d.Repo.Push(op.Remote, op.Token); err != nil {
			writeErr(w, statusFor(err), err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"pushed": true})
	})

	r.Post("/api/repo/fetch", func(w http.ResponseWriter, req *http.Request) {
		op := readOp(req)
		if err := d.Repo.Fetch(op.Remote, op.Token); err != nil {
			writeErr(w, statusFor(err), err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"fetched": true})
	})

	r.Post("/api/repo/pull", func(w http.ResponseWriter, req *http.Request) {
		op := readOp(req)
		res, err := d.Repo.Pull(op.Remote, op.Token)
		if err != nil {
			writeErr(w, statusFor(err), err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
}
