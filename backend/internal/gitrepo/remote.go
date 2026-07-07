package gitrepo

import (
	"errors"
	"fmt"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
	"github.com/zalando/go-keyring"
)

const remoteCredService = "SqlVcIde-Git"

// RemoteInfo describes one configured remote.
type RemoteInfo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func (m *Manager) Remotes() ([]RemoteInfo, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	remotes, err := repo.Remotes()
	if err != nil {
		return nil, err
	}
	var out []RemoteInfo
	for _, r := range remotes {
		cfg := r.Config()
		url := ""
		if len(cfg.URLs) > 0 {
			url = cfg.URLs[0]
		}
		out = append(out, RemoteInfo{Name: cfg.Name, URL: url})
	}
	return out, nil
}

// SetRemote creates or updates a named remote.
func (m *Manager) SetRemote(name, url string) error {
	repo, _, err := m.current()
	if err != nil {
		return err
	}
	if _, err := repo.Remote(name); err == nil {
		if err := repo.DeleteRemote(name); err != nil {
			return err
		}
	}
	_, err = repo.CreateRemote(&config.RemoteConfig{Name: name, URLs: []string{url}})
	return err
}

// SaveRemoteToken stores a PAT for a remote URL in the credential manager.
func SaveRemoteToken(url, token string) error {
	return keyring.Set(remoteCredService, url, token)
}

func remoteToken(url string) string {
	tok, err := keyring.Get(remoteCredService, url)
	if err != nil {
		return ""
	}
	return tok
}

// auth builds HTTP basic auth from a stored or provided PAT. GitHub and
// Azure DevOps both accept any username with a PAT password.
func (m *Manager) auth(remoteName, token string) (*githttp.BasicAuth, string, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, "", err
	}
	r, err := repo.Remote(remoteName)
	if err != nil {
		return nil, "", fmt.Errorf("remote %q not configured", remoteName)
	}
	url := r.Config().URLs[0]
	if token == "" {
		token = remoteToken(url)
	}
	if token == "" && strings.Contains(url, "github.com") {
		// Fall back to the token saved by GitHub sign-in (see httpapi's
		// /api/github/login), stored under the fixed "github.com" account
		// rather than this specific remote URL.
		if tok, err := keyring.Get(remoteCredService, "github.com"); err == nil {
			token = tok
		}
	}
	if token == "" {
		return nil, url, nil // public repos work anonymously for fetch
	}
	return &githttp.BasicAuth{Username: "svcide", Password: token}, url, nil
}

// Push pushes the current branch. A non-empty token is used (and stored on
// success); otherwise the stored token for the remote URL is used.
func (m *Manager) Push(remoteName, token string) error {
	repo, _, err := m.current()
	if err != nil {
		return err
	}
	auth, url, err := m.auth(remoteName, token)
	if err != nil {
		return err
	}
	head, err := repo.Head()
	if err != nil {
		return err
	}
	refspec := config.RefSpec(fmt.Sprintf("%s:%s", head.Name(), head.Name()))
	err = repo.Push(&git.PushOptions{
		RemoteName: remoteName,
		RefSpecs:   []config.RefSpec{refspec},
		Auth:       authOrNil(auth),
	})
	if errors.Is(err, git.NoErrAlreadyUpToDate) {
		err = nil
	}
	if err == nil && token != "" {
		_ = SaveRemoteToken(url, token)
	}
	return humanizeAuthErr(err)
}

// Fetch fetches all branches from the remote.
func (m *Manager) Fetch(remoteName, token string) error {
	repo, _, err := m.current()
	if err != nil {
		return err
	}
	auth, url, err := m.auth(remoteName, token)
	if err != nil {
		return err
	}
	err = repo.Fetch(&git.FetchOptions{RemoteName: remoteName, Auth: authOrNil(auth)})
	if errors.Is(err, git.NoErrAlreadyUpToDate) {
		err = nil
	}
	if err == nil && token != "" {
		_ = SaveRemoteToken(url, token)
	}
	return humanizeAuthErr(err)
}

// Pull fetches then merges origin/<current-branch> using the same file-level
// merge used for local branches. Returns the merge result.
func (m *Manager) Pull(remoteName, token string) (*MergeResult, error) {
	if err := m.Fetch(remoteName, token); err != nil {
		return nil, err
	}
	branch, err := m.CurrentBranch()
	if err != nil {
		return nil, err
	}
	remoteRef := remoteName + "/" + branch
	// If the remote branch doesn't exist there is nothing to merge.
	if _, err := m.resolveRef(remoteRef); err != nil {
		return &MergeResult{Status: "up-to-date"}, nil
	}
	return m.Merge(remoteRef)
}

func authOrNil(a *githttp.BasicAuth) transport.AuthMethod {
	if a == nil {
		return nil
	}
	return a
}

// humanizeAuthErr converts opaque transport errors into actionable messages.
func humanizeAuthErr(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "authentication required") || strings.Contains(msg, "authorization failed") {
		return errors.New("authentication failed — provide a Personal Access Token with repo write access")
	}
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		return errors.New("remote branch not found")
	}
	return err
}
