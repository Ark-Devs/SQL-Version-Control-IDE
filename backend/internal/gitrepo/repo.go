package gitrepo

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// Manager holds the currently open repository (one at a time).
type Manager struct {
	mu      sync.Mutex
	repo    *git.Repository
	path    string
	pending *pendingMerge
}

func NewManager() *Manager { return &Manager{} }

var ErrNoRepo = errors.New("no repository is open")

func (m *Manager) Open(path string) error {
	repo, err := git.PlainOpen(path)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.repo, m.path = repo, path
	return nil
}

// Init creates a new repository at path (creating the directory if needed)
// with "main" as the baseline branch.
func (m *Manager) Init(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	repo, err := git.PlainInitWithOptions(path, &git.PlainInitOptions{
		InitOptions: git.InitOptions{DefaultBranch: plumbing.Main},
	})
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.repo, m.path = repo, path
	m.mu.Unlock()
	return nil
}

func (m *Manager) current() (*git.Repository, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.repo == nil {
		return nil, "", ErrNoRepo
	}
	return m.repo, m.path, nil
}

func (m *Manager) Path() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.path
}

// IsOpen reports whether a repository is currently open.
func (m *Manager) IsOpen() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.repo != nil
}

// signature builds the commit author from git config or a fallback.
func (m *Manager) signature() *object.Signature {
	name, email := "SQL VC IDE", "svcide@local"
	if repo, _, err := m.current(); err == nil {
		if cfg, err := repo.ConfigScoped(2); err == nil { // GlobalScope
			if cfg.User.Name != "" {
				name = cfg.User.Name
			}
			if cfg.User.Email != "" {
				email = cfg.User.Email
			}
		}
	}
	return &object.Signature{Name: name, Email: email, When: time.Now()}
}

type FileStatus struct {
	Path  string `json:"path"`
	State string `json:"state"` // added | modified | deleted
}

// Status returns worktree changes vs HEAD.
func (m *Manager) Status() ([]FileStatus, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	wt, err := repo.Worktree()
	if err != nil {
		return nil, err
	}
	st, err := wt.Status()
	if err != nil {
		return nil, err
	}
	var out []FileStatus
	for path, s := range st {
		state := ""
		code := s.Worktree
		if code == git.Unmodified {
			code = s.Staging
		}
		switch code {
		case git.Untracked, git.Added:
			state = "added"
		case git.Modified, git.Renamed, git.Copied:
			state = "modified"
		case git.Deleted:
			state = "deleted"
		default:
			continue
		}
		out = append(out, FileStatus{Path: filepath.ToSlash(path), State: state})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// Commit stages the given paths (all changes when empty) and commits.
func (m *Manager) Commit(message string, paths []string) (string, error) {
	repo, _, err := m.current()
	if err != nil {
		return "", err
	}
	wt, err := repo.Worktree()
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		if err := wt.AddWithOptions(&git.AddOptions{All: true}); err != nil {
			return "", err
		}
	} else {
		st, err := wt.Status()
		if err != nil {
			return "", err
		}
		for _, p := range paths {
			p = filepath.ToSlash(p)
			if s, ok := st[p]; ok && s.Worktree == git.Deleted {
				if _, err := wt.Remove(p); err != nil {
					return "", err
				}
			} else if _, err := wt.Add(p); err != nil {
				return "", err
			}
		}
	}
	hash, err := wt.Commit(message, &git.CommitOptions{Author: m.signature()})
	if err != nil {
		return "", err
	}
	return hash.String(), nil
}

// Discard restores the given worktree paths to their HEAD state.
func (m *Manager) Discard(paths []string) error {
	repo, root, err := m.current()
	if err != nil {
		return err
	}
	wt, err := repo.Worktree()
	if err != nil {
		return err
	}
	st, err := wt.Status()
	if err != nil {
		return err
	}
	_ = wt
	for _, p := range paths {
		p = filepath.ToSlash(p)
		abs := filepath.Join(root, filepath.FromSlash(p))
		if s, ok := st[p]; ok && s.Worktree == git.Untracked {
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		// tracked: restore content from HEAD (also resurrects deletions)
		content, err := m.FileAtRef(p, "HEAD")
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

type BranchInfo struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
}

func (m *Manager) Branches() ([]BranchInfo, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	head, _ := repo.Head()
	cur := ""
	if head != nil {
		cur = head.Name().Short()
	}
	iter, err := repo.Branches()
	if err != nil {
		return nil, err
	}
	var out []BranchInfo
	_ = iter.ForEach(func(ref *plumbing.Reference) error {
		out = append(out, BranchInfo{Name: ref.Name().Short(), Current: ref.Name().Short() == cur})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (m *Manager) CurrentBranch() (string, error) {
	repo, _, err := m.current()
	if err != nil {
		return "", err
	}
	head, err := repo.Head()
	if err != nil {
		return "", err
	}
	return head.Name().Short(), nil
}

// CreateBranch creates a branch at HEAD (or at `from` if given) without switching.
func (m *Manager) CreateBranch(name, from string) error {
	repo, _, err := m.current()
	if err != nil {
		return err
	}
	target := "HEAD"
	if from != "" {
		target = from
	}
	hash, err := m.resolveRef(target)
	if err != nil {
		return err
	}
	ref := plumbing.NewHashReference(plumbing.NewBranchReferenceName(name), *hash)
	return repo.Storer.SetReference(ref)
}

var ErrDirtyWorktree = errors.New("worktree has uncommitted changes; commit or discard them first")

// Checkout switches branches; refuses when the worktree is dirty.
func (m *Manager) Checkout(name string) error {
	repo, _, err := m.current()
	if err != nil {
		return err
	}
	changes, err := m.Status()
	if err != nil {
		return err
	}
	if len(changes) > 0 {
		return ErrDirtyWorktree
	}
	wt, err := repo.Worktree()
	if err != nil {
		return err
	}
	return wt.Checkout(&git.CheckoutOptions{Branch: plumbing.NewBranchReferenceName(name)})
}

type LogEntry struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	Date    string `json:"date"`
	Message string `json:"message"`
}

// Log returns commit history, optionally limited to one file path.
func (m *Manager) Log(path string, limit int) ([]LogEntry, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	opts := &git.LogOptions{}
	if path != "" {
		p := filepath.ToSlash(path)
		opts.FileName = &p
	}
	iter, err := repo.Log(opts)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	var out []LogEntry
	err = iter.ForEach(func(c *object.Commit) error {
		if len(out) >= limit {
			return errors.New("done")
		}
		out = append(out, LogEntry{
			Hash:    c.Hash.String(),
			Author:  c.Author.Name,
			Email:   c.Author.Email,
			Date:    c.Author.When.Format("2006-01-02 15:04"),
			Message: strings.TrimSpace(c.Message),
		})
		return nil
	})
	if err != nil && err.Error() != "done" {
		return nil, err
	}
	return out, nil
}

// resolveRef resolves branch names, HEAD, and hashes to a commit hash.
func (m *Manager) resolveRef(ref string) (*plumbing.Hash, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	return repo.ResolveRevision(plumbing.Revision(ref))
}

// FileAtRef returns a file's content at a ref, or from the worktree when
// ref is "WORKING".
func (m *Manager) FileAtRef(path, ref string) (string, error) {
	repo, root, err := m.current()
	if err != nil {
		return "", err
	}
	path = filepath.ToSlash(path)
	if ref == "WORKING" {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	hash, err := m.resolveRef(ref)
	if err != nil {
		return "", err
	}
	commit, err := repo.CommitObject(*hash)
	if err != nil {
		return "", err
	}
	file, err := commit.File(path)
	if err != nil {
		return "", fmt.Errorf("%s not found at %s: %w", path, ref, err)
	}
	return file.Contents()
}
