package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zalando/go-keyring"
)

// githubCredService matches gitrepo's remote credential service name so a
// GitHub sign-in doubles as the stored PAT for git push/fetch/pull against
// github.com (see gitrepo.remoteCredService and the auth() fallback below).
const githubCredService = "SqlVcIde-Git"
const githubCredAccount = "github.com"

type githubUser struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// fetchGitHubUser calls GET /user with the given token. A non-200 response
// or transport error both come back as a single friendly error — callers
// never get a partially populated user.
func fetchGitHubUser(ctx context.Context, token string) (*githubUser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("GitHub rejected the token")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("GitHub rejected the token")
	}
	var u githubUser
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

func mountGitHub(r chi.Router, d *Deps) {
	r.Post("/api/github/login", func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Token string `json:"token"`
		}
		if err := decode(req, &body); err != nil || body.Token == "" {
			writeErr(w, http.StatusBadRequest, errors.New("token is required"))
			return
		}
		user, err := fetchGitHubUser(req.Context(), body.Token)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err)
			return
		}
		if err := keyring.Set(githubCredService, githubCredAccount, body.Token); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"signedIn": true,
			"login":    user.Login,
			"name":     user.Name,
		})
	})

	r.Get("/api/github/user", func(w http.ResponseWriter, req *http.Request) {
		token, err := keyring.Get(githubCredService, githubCredAccount)
		if err != nil || token == "" {
			writeJSON(w, http.StatusOK, map[string]any{"signedIn": false})
			return
		}
		user, err := fetchGitHubUser(req.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"signedIn": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"signedIn": true,
			"login":    user.Login,
		})
	})

	r.Post("/api/github/logout", func(w http.ResponseWriter, _ *http.Request) {
		if err := keyring.Delete(githubCredService, githubCredAccount); err != nil && err != keyring.ErrNotFound {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"signedIn": false})
	})
}
