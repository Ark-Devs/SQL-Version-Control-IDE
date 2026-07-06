package deploy

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"

	"svcide/internal/gitrepo"
)

// Step is one object deployment within a plan.
type Step struct {
	Path     string `json:"path"`
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	SQL      string `json:"sql"`
}

// Plan is a prepared deployment: ordered scripts read from a git ref.
// Each object deploys to its own database name on the target connection
// (a system repo can span Hospital, Pharmacy, … on one server).
type Plan struct {
	ID           string   `json:"id"`
	Ref          string   `json:"ref"`
	TargetConnID string   `json:"targetConnId"`
	Steps        []Step   `json:"steps"`
	Warnings     []string `json:"warnings"`
}

// typeOrder deploys dependencies before dependents: functions → views →
// procs → triggers.
var typeOrder = map[string]int{
	"scalar":  0,
	"tvf":     1,
	"view":    2,
	"proc":    3,
	"trigger": 4,
}

// Planner builds plans from the open repo and keeps them until execution.
type Planner struct {
	mu    sync.Mutex
	repo  *gitrepo.Manager
	plans map[string]*Plan
}

func NewPlanner(repo *gitrepo.Manager) *Planner {
	return &Planner{repo: repo, plans: map[string]*Plan{}}
}

// BuildPlan reads the requested object files at ref and orders them for
// deployment. paths empty = all deployable objects in the manifest at ref.
func (p *Planner) BuildPlan(ref string, paths []string, targetConnID string) (*Plan, error) {
	manifest, err := p.manifestAt(ref)
	if err != nil {
		return nil, err
	}

	plan := &Plan{
		ID:           uuid.NewString(),
		Ref:          ref,
		TargetConnID: targetConnID,
	}

	selected := paths
	if len(selected) == 0 {
		for path := range manifest.Objects {
			selected = append(selected, path)
		}
	}
	sort.Strings(selected)

	for _, path := range selected {
		obj, ok := manifest.Objects[path]
		if !ok {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("%s is not in the manifest at %s — skipped", path, ref))
			continue
		}
		if obj.Type == "table" {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("%s.%s is a table — tables are tracked for history only and are not deployed", obj.Schema, obj.Name))
			continue
		}
		sql, err := p.repo.FileAtRef(path, ref)
		if err != nil {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("%s could not be read at %s: %v — skipped", path, ref, err))
			continue
		}
		if !hasCreateOrAlterHeader(sql) {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("%s does not start with CREATE OR ALTER — deployed as-is, may fail if the object exists", path))
		}
		plan.Steps = append(plan.Steps, Step{
			Path:     path,
			Database: obj.Database,
			Schema:   obj.Schema,
			Name:     obj.Name,
			Type:     obj.Type,
			SQL:      sql,
		})
	}

	sort.SliceStable(plan.Steps, func(i, j int) bool {
		if plan.Steps[i].Database != plan.Steps[j].Database {
			return plan.Steps[i].Database < plan.Steps[j].Database
		}
		return typeOrder[plan.Steps[i].Type] < typeOrder[plan.Steps[j].Type]
	})

	p.mu.Lock()
	p.plans[plan.ID] = plan
	p.mu.Unlock()
	return plan, nil
}

// Get returns a stored plan.
func (p *Planner) Get(id string) (*Plan, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	plan, ok := p.plans[id]
	return plan, ok
}

// Release drops a plan from memory.
func (p *Planner) Release(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.plans, id)
}

// manifestAt reads .svcide/manifest.json at a ref (WORKING uses the file on disk).
func (p *Planner) manifestAt(ref string) (*gitrepo.Manifest, error) {
	if ref == "WORKING" {
		return p.repo.ReadManifest()
	}
	content, err := p.repo.FileAtRef(".svcide/manifest.json", ref)
	if err != nil {
		return nil, fmt.Errorf("manifest at %s: %w", ref, err)
	}
	return gitrepo.ParseManifest([]byte(content))
}

// hasCreateOrAlterHeader checks the first meaningful token sequence.
func hasCreateOrAlterHeader(sql string) bool {
	s := strings.ToUpper(sql)
	// strip leading comments the cheap way: scan lines
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "--") {
			continue
		}
		return strings.HasPrefix(t, "CREATE OR ALTER")
	}
	return false
}
