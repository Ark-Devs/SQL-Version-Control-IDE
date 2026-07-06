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
	Path   string `json:"path"`
	Object string `json:"object"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

// Result is the outcome of executing a plan.
type Result struct {
	Committed bool         `json:"committed"`
	Steps     []StepResult `json:"steps"`
	Error     string       `json:"error,omitempty"`
	ElapsedMs int64        `json:"elapsedMs"`
}

// Execute runs a plan inside one transaction on a dedicated connection.
// Failed steps get one retry pass (dependency order); any remaining failure
// rolls everything back.
func Execute(ctx context.Context, pool *sql.DB, plan *Plan) (*Result, error) {
	start := time.Now()
	res := &Result{}

	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "SET XACT_ABORT OFF; BEGIN TRANSACTION"); err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}

	rollback := func() {
		_, _ = conn.ExecContext(context.Background(), "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION")
	}

	type pending struct {
		step Step
		idx  int
	}
	var failed []pending
	results := make([]StepResult, len(plan.Steps))

	runStep := func(s Step, idx int) bool {
		for _, batch := range dbpkg.SplitBatches(s.SQL) {
			if _, err := conn.ExecContext(ctx, batch); err != nil {
				results[idx] = StepResult{Path: s.Path, Object: s.Schema + "." + s.Name, OK: false, Error: err.Error()}
				return false
			}
		}
		results[idx] = StepResult{Path: s.Path, Object: s.Schema + "." + s.Name, OK: true}
		return true
	}

	for i, s := range plan.Steps {
		if ctx.Err() != nil {
			rollback()
			return nil, ctx.Err()
		}
		if !runStep(s, i) {
			failed = append(failed, pending{s, i})
		}
	}
	// retry pass: earlier failures may have been dependency ordering issues
	var stillFailed []pending
	for _, f := range failed {
		if !runStep(f.step, f.idx) {
			stillFailed = append(stillFailed, f)
		}
	}

	res.Steps = results
	if len(stillFailed) > 0 {
		rollback()
		res.Committed = false
		res.Error = fmt.Sprintf("%d object(s) failed — all changes rolled back", len(stillFailed))
	} else {
		if _, err := conn.ExecContext(ctx, "COMMIT TRANSACTION"); err != nil {
			rollback()
			return nil, fmt.Errorf("commit: %w", err)
		}
		res.Committed = true
	}
	res.ElapsedMs = time.Since(start).Milliseconds()

	recordHistory(plan, res)
	return res, nil
}

// historyEntry is one line in %APPDATA%\SqlVcIde\deploy-history.json.
type historyEntry struct {
	When      string       `json:"when"`
	Ref       string       `json:"ref"`
	TargetDB  string       `json:"targetDb"`
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
		TargetDB:  plan.TargetDB,
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
