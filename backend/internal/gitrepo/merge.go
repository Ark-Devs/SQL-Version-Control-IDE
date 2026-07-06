package gitrepo

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// MergeResult reports the outcome of a merge attempt.
type MergeResult struct {
	Status    string          `json:"status"` // up-to-date | fast-forward | merged | conflicts
	Conflicts []MergeConflict `json:"conflicts,omitempty"`
}

// MergeConflict is a file changed on both sides since the merge base.
type MergeConflict struct {
	Path   string `json:"path"`
	Base   string `json:"base"`
	Ours   string `json:"ours"`
	Theirs string `json:"theirs"`
}

// pendingMerge remembers an in-progress conflicted merge until resolution.
type pendingMerge struct {
	fromBranch string
	fromHash   plumbing.Hash
	conflicts  map[string]bool
	resolved   map[string]string // path → chosen content
}

// Merge merges `from` into the current branch.
//
// Strategy (file-level, no hunk merging):
//   - already contained → up-to-date
//   - HEAD is ancestor of from → fast-forward
//   - otherwise: files changed only in `from` are taken; files changed on both
//     sides (relative to the merge base) become conflicts the user resolves.
func (m *Manager) Merge(from string) (*MergeResult, error) {
	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	if changes, err := m.Status(); err != nil {
		return nil, err
	} else if len(changes) > 0 {
		return nil, ErrDirtyWorktree
	}

	head, err := repo.Head()
	if err != nil {
		return nil, err
	}
	oursHash := head.Hash()
	theirsHashP, err := m.resolveRef(from)
	if err != nil {
		return nil, fmt.Errorf("branch %q: %w", from, err)
	}
	theirsHash := *theirsHashP

	oursCommit, err := repo.CommitObject(oursHash)
	if err != nil {
		return nil, err
	}
	theirsCommit, err := repo.CommitObject(theirsHash)
	if err != nil {
		return nil, err
	}

	bases, err := oursCommit.MergeBase(theirsCommit)
	if err != nil || len(bases) == 0 {
		return nil, fmt.Errorf("no common ancestor between HEAD and %s", from)
	}
	base := bases[0]

	if base.Hash == theirsHash {
		return &MergeResult{Status: "up-to-date"}, nil
	}
	if base.Hash == oursHash {
		// fast-forward: move branch ref then reset worktree
		ref := plumbing.NewHashReference(head.Name(), theirsHash)
		if err := repo.Storer.SetReference(ref); err != nil {
			return nil, err
		}
		wt, err := repo.Worktree()
		if err != nil {
			return nil, err
		}
		if err := wt.Reset(&git.ResetOptions{Commit: theirsHash, Mode: git.HardReset}); err != nil {
			return nil, err
		}
		return &MergeResult{Status: "fast-forward"}, nil
	}

	// three-way at file level
	changedOurs, err := changedFiles(base, oursCommit)
	if err != nil {
		return nil, err
	}
	changedTheirs, err := changedFiles(base, theirsCommit)
	if err != nil {
		return nil, err
	}

	var conflicts []MergeConflict
	takeTheirs := map[string]bool{}
	for path := range changedTheirs {
		if changedOurs[path] {
			baseC, _ := contentAt(base, path)
			oursC, _ := contentAt(oursCommit, path)
			theirsC, _ := contentAt(theirsCommit, path)
			if oursC == theirsC {
				continue // both sides made the identical change
			}
			conflicts = append(conflicts, MergeConflict{Path: path, Base: baseC, Ours: oursC, Theirs: theirsC})
		} else {
			takeTheirs[path] = true
		}
	}

	if len(conflicts) > 0 {
		m.mu.Lock()
		m.pending = &pendingMerge{
			fromBranch: from,
			fromHash:   theirsHash,
			conflicts:  map[string]bool{},
			resolved:   map[string]string{},
		}
		for _, c := range conflicts {
			m.pending.conflicts[c.Path] = true
		}
		m.mu.Unlock()
		return &MergeResult{Status: "conflicts", Conflicts: conflicts}, nil
	}

	if err := m.applyMerge(takeTheirs, theirsCommit, nil, from, theirsHash); err != nil {
		return nil, err
	}
	return &MergeResult{Status: "merged"}, nil
}

// Resolve completes a conflicted merge with user-chosen file contents.
func (m *Manager) Resolve(resolutions map[string]string) (*MergeResult, error) {
	m.mu.Lock()
	pending := m.pending
	m.mu.Unlock()
	if pending == nil {
		return nil, errors.New("no merge in progress")
	}
	for path := range pending.conflicts {
		if _, ok := resolutions[path]; !ok {
			return nil, fmt.Errorf("missing resolution for %s", path)
		}
	}

	repo, _, err := m.current()
	if err != nil {
		return nil, err
	}
	theirsCommit, err := repo.CommitObject(pending.fromHash)
	if err != nil {
		return nil, err
	}
	head, err := repo.Head()
	if err != nil {
		return nil, err
	}
	oursCommit, err := repo.CommitObject(head.Hash())
	if err != nil {
		return nil, err
	}
	bases, err := oursCommit.MergeBase(theirsCommit)
	if err != nil || len(bases) == 0 {
		return nil, errors.New("merge base disappeared")
	}
	changedOurs, err := changedFiles(bases[0], oursCommit)
	if err != nil {
		return nil, err
	}
	changedTheirs, err := changedFiles(bases[0], theirsCommit)
	if err != nil {
		return nil, err
	}
	takeTheirs := map[string]bool{}
	for path := range changedTheirs {
		if !changedOurs[path] && !pending.conflicts[path] {
			takeTheirs[path] = true
		}
	}

	if err := m.applyMerge(takeTheirs, theirsCommit, resolutions, pending.fromBranch, pending.fromHash); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.pending = nil
	m.mu.Unlock()
	return &MergeResult{Status: "merged"}, nil
}

// AbortMerge drops the pending merge state.
func (m *Manager) AbortMerge() {
	m.mu.Lock()
	m.pending = nil
	m.mu.Unlock()
}

// applyMerge writes taken/resolved files into the worktree and creates a
// merge commit with both parents.
func (m *Manager) applyMerge(takeTheirs map[string]bool, theirs *object.Commit, resolutions map[string]string, fromName string, fromHash plumbing.Hash) error {
	repo, root, err := m.current()
	if err != nil {
		return err
	}
	wt, err := repo.Worktree()
	if err != nil {
		return err
	}

	write := func(path, content string) error {
		abs := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return err
		}
		return os.WriteFile(abs, []byte(content), 0o644)
	}

	for path := range takeTheirs {
		content, err := contentAt(theirs, path)
		if err != nil {
			// deleted in theirs → delete here too
			abs := filepath.Join(root, filepath.FromSlash(path))
			if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
				return err
			}
			if _, err := wt.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				// ignore: file may be untracked
				_ = err
			}
			continue
		}
		if err := write(path, content); err != nil {
			return err
		}
		if _, err := wt.Add(path); err != nil {
			return err
		}
	}
	for path, content := range resolutions {
		if err := write(path, content); err != nil {
			return err
		}
		if _, err := wt.Add(path); err != nil {
			return err
		}
	}

	head, err := repo.Head()
	if err != nil {
		return err
	}
	_, err = wt.Commit(fmt.Sprintf("Merge branch '%s'", fromName), &git.CommitOptions{
		Author:  m.signature(),
		Parents: []plumbing.Hash{head.Hash(), fromHash},
	})
	return err
}

// changedFiles lists paths whose content differs between two commits.
func changedFiles(from, to *object.Commit) (map[string]bool, error) {
	fromTree, err := from.Tree()
	if err != nil {
		return nil, err
	}
	toTree, err := to.Tree()
	if err != nil {
		return nil, err
	}
	changes, err := fromTree.Diff(toTree)
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, ch := range changes {
		if ch.From.Name != "" {
			out[ch.From.Name] = true
		}
		if ch.To.Name != "" {
			out[ch.To.Name] = true
		}
	}
	return out, nil
}

// contentAt returns a file's content in a commit ("" when absent).
func contentAt(c *object.Commit, path string) (string, error) {
	f, err := c.File(path)
	if err != nil {
		return "", err
	}
	return f.Contents()
}
