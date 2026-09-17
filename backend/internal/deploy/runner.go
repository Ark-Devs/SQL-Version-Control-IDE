package deploy

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	dbpkg "svcide/internal/db"
)

// StepResult is the outcome of one object deployment.
type StepResult struct {
	Path     string `json:"path"`
	Alias    string `json:"alias"`
	Database string `json:"database"`
	Object   string `json:"object"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

// Result is the outcome of executing a plan. Each source group runs in its
// own transaction: a failing group rolls back without affecting the others.
type Result struct {
	Committed bool         `json:"committed"` // every group committed
	Steps     []StepResult `json:"steps"`
	Error     string       `json:"error,omitempty"`
	ElapsedMs int64        `json:"elapsedMs"`
}

// PoolFunc resolves a source alias and its database name to a pool. The alias
// selects the connection (sources may sit on different servers); the database
// name selects the catalog on it.
type PoolFunc func(alias, database string) (*sql.DB, error)

// Execute runs a plan. Steps are grouped by source alias — not by database
// name, since two aliases may be the same database on different servers and
// cannot share a connection, let alone a transaction. Each group executes on a
// dedicated connection inside one transaction with a single retry pass for
// dependency-ordering failures.
func Execute(ctx context.Context, poolFor PoolFunc, plan *Plan) (*Result, error) {
	start := time.Now()
	res := &Result{Committed: true}

	// group steps by alias, preserving plan order
	groups := map[string][]Step{}
	var aliasOrder []string
	for _, s := range plan.Steps {
		if _, ok := groups[s.Alias]; !ok {
			aliasOrder = append(aliasOrder, s.Alias)
		}
		groups[s.Alias] = append(groups[s.Alias], s)
	}

	var failedGroups []string
	for _, alias := range aliasOrder {
		steps := groups[alias]
		stepResults, err := executeGroup(ctx, poolFor, alias, steps[0].Database, steps)
		if err != nil {
			return nil, err
		}
		res.Steps = append(res.Steps, stepResults...)
		for _, sr := range stepResults {
			if !sr.OK {
				res.Committed = false
				failedGroups = append(failedGroups, alias)
				break
			}
		}
	}
	if len(failedGroups) > 0 {
		res.Error = fmt.Sprintf("rolled back: %v — other sources were committed", failedGroups)
	}
	res.ElapsedMs = time.Since(start).Milliseconds()

	recordHistory(plan, res)
	return res, nil
}

func executeGroup(ctx context.Context, poolFor PoolFunc, alias, database string, steps []Step) ([]StepResult, error) {
	pool, err := poolFor(alias, database)
	if err != nil {
		return nil, fmt.Errorf("connect to %s: %w", alias, err)
	}
	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "SET XACT_ABORT OFF; BEGIN TRANSACTION"); err != nil {
		return nil, fmt.Errorf("begin transaction on %s: %w", alias, err)
	}
	rollback := func() {
		_, _ = conn.ExecContext(context.Background(), "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION")
	}

	results := make([]StepResult, len(steps))
	runStep := func(s Step, idx int) bool {
		for _, batch := range dbpkg.SplitBatches(s.SQL) {
			if _, err := conn.ExecContext(ctx, batch); err != nil {
				results[idx] = StepResult{Path: s.Path, Alias: alias, Database: database, Object: s.Schema + "." + s.Name, OK: false, Error: err.Error()}
				return false
			}
		}
		results[idx] = StepResult{Path: s.Path, Alias: alias, Database: database, Object: s.Schema + "." + s.Name, OK: true}
		return true
	}

	type pending struct {
		step Step
		idx  int
	}
	var failed []pending
	for i, s := range steps {
		if ctx.Err() != nil {
			rollback()
			return nil, ctx.Err()
		}
		if !runStep(s, i) {
			failed = append(failed, pending{s, i})
		}
	}
	// retry pass: earlier failures may have been dependency ordering issues
	anyFailed := false
	for _, f := range failed {
		if !runStep(f.step, f.idx) {
			anyFailed = true
		}
	}

	if anyFailed {
		rollback()
	} else if _, err := conn.ExecContext(ctx, "COMMIT TRANSACTION"); err != nil {
		rollback()
		return nil, fmt.Errorf("commit on %s: %w", alias, err)
	}
	return results, nil
}

// historyEntry is one line in %APPDATA%\SqlVcIde\deploy-history.json.
type historyEntry struct {
	When      string       `json:"when"`
	Ref       string       `json:"ref"`
	Committed bool         `json:"committed"`
	Steps     []StepResult `json:"steps"`
}

func recordHistory(plan *Plan, res *Result) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return
	}
	path := filepath.Join(appData, "SqlVcIde", "deploy-history.json")
	var entries []historyEntry
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &entries)
	}
	entries = append(entries, historyEntry{
		When:      time.Now().Format(time.RFC3339),
		Ref:       plan.Ref,
		Committed: res.Committed,
		Steps:     res.Steps,
	})
	if len(entries) > 200 {
		entries = entries[len(entries)-200:]
	}
	if data, err := json.MarshalIndent(entries, "", "  "); err == nil {
		_ = os.WriteFile(path, data, 0o644)
	}
}
