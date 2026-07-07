package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zalando/go-keyring"
)

// mountUpdates proxies the GitHub "latest release" lookup so private repos
// work: the stored GitHub sign-in token is attached when available.
func mountUpdates(r chi.Router, d *Deps) {
	_ = d
	r.Get("/api/updates/check", func(w http.ResponseWriter, req *http.Request) {
		repo := req.URL.Query().Get("repo")
		current := req.URL.Query().Get("current")
		if repo == "" || !strings.Contains(repo, "/") || current == "" {
			writeErr(w, http.StatusBadRequest, errors.New("repo (owner/name) and current version are required"))
			return
		}

		apiURL := "https://api.github.com/repos/" + repo + "/releases/latest"
		httpReq, err := http.NewRequestWithContext(req.Context(), "GET", apiURL, nil)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		httpReq.Header.Set("Accept", "application/vnd.github+json")
		httpReq.Header.Set("User-Agent", "SqlVcIde")
		if token, err := keyring.Get("SqlVcIde-Git", "github.com"); err == nil && token != "" {
			httpReq.Header.Set("Authorization", "Bearer "+token)
		}

		client := &http.Client{Timeout: 10 * time.Second}
		res, err := client.Do(httpReq)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			// private repo without token, no releases yet, offline — not an error
			writeJSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		body, _ := io.ReadAll(res.Body)
		var release struct {
			TagName    string `json:"tag_name"`
			HTMLURL    string `json:"html_url"`
			Draft      bool   `json:"draft"`
			Prerelease bool   `json:"prerelease"`
		}
		if err := json.Unmarshal(body, &release); err != nil || release.TagName == "" || release.Draft || release.Prerelease {
			writeJSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		latest := strings.TrimPrefix(strings.ToLower(release.TagName), "v")
		if compareVersions(current, latest) >= 0 {
			writeJSON(w, http.StatusOK, map[string]any{"available": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"available": true,
			"version":   latest,
			"url":       release.HTMLURL,
		})
	})
}

// compareVersions: negative when a < b (numeric dotted versions).
func compareVersions(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(strings.TrimSpace(pa[i]))
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(strings.TrimSpace(pb[i]))
		}
		if x != y {
			return x - y
		}
	}
	return 0
}
