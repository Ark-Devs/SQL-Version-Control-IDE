package gitrepo

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"svcide/internal/db"
)

func TestClassifyCompare(t *testing.T) {
	mo := func(db, schema, name, typ string) ManifestObject {
		return ManifestObject{Database: db, Schema: schema, Name: name, Type: typ}
	}
	pIdentical := ObjectPath("Hospital", "dbo", "usp_Same", "proc")
	pDifferent := ObjectPath("Hospital", "dbo", "usp_Diff", "proc")
	pMissing := ObjectPath("Hospital", "dbo", "usp_RepoOnly", "proc")
	pOnlyTarget := ObjectPath("Hospital", "dbo", "usp_TargetOnly", "proc")

	repo := map[string]compareEntry{
		pIdentical: {obj: mo("Hospital", "dbo", "usp_Same", "proc"), sql: "SELECT 1\n"},
		pDifferent: {obj: mo("Hospital", "dbo", "usp_Diff", "proc"), sql: "SELECT 1\n"},
		pMissing:   {obj: mo("Hospital", "dbo", "usp_RepoOnly", "proc"), sql: "SELECT 9\n"},
	}
	target := map[string]compareEntry{
		pIdentical:  {obj: mo("Hospital", "dbo", "usp_Same", "proc"), sql: "SELECT 1\n"},
		pDifferent:  {obj: mo("Hospital", "dbo", "usp_Diff", "proc"), sql: "SELECT 2\n"},
		pOnlyTarget: {obj: mo("Hospital", "dbo", "usp_TargetOnly", "proc"), sql: "SELECT 3\n"},
	}

	got := classifyCompare(repo, target)
	if len(got) != 4 {
		t.Fatalf("expected 4 objects, got %d: %+v", len(got), got)
	}
	byPath := map[string]CompareObject{}
	for _, o := range got {
		byPath[o.Path] = o
	}

	if o := byPath[pIdentical]; o.State != StateIdentical || o.RepoSQL != "" || o.TargetSQL != "" {
		t.Errorf("identical = %+v, want state identical with no SQL", o)
	}
	if o := byPath[pDifferent]; o.State != StateDifferent || o.RepoSQL != "SELECT 1\n" || o.TargetSQL != "SELECT 2\n" {
		t.Errorf("different = %+v, want state different with both SQL sides", o)
	}
	if o := byPath[pMissing]; o.State != StateMissingOnTarget || o.RepoSQL != "SELECT 9\n" || o.TargetSQL != "" {
		t.Errorf("missing = %+v, want missingOnTarget with repo SQL only", o)
	}
	if o := byPath[pOnlyTarget]; o.State != StateOnlyOnTarget || o.TargetSQL != "SELECT 3\n" || o.RepoSQL != "" {
		t.Errorf("onlyOnTarget = %+v, want onlyOnTarget with target SQL only", o)
	}

	// identity fields are carried through regardless of which side wins
	if o := byPath[pOnlyTarget]; o.Database != "Hospital" || o.Schema != "dbo" || o.Name != "usp_TargetOnly" || o.Type != "proc" {
		t.Errorf("onlyOnTarget identity = %+v, want Hospital/dbo/usp_TargetOnly/proc", o)
	}

	// ordering is by path
	for i := 1; i < len(got); i++ {
		if got[i-1].Path > got[i].Path {
			t.Errorf("results not sorted by path: %q before %q", got[i-1].Path, got[i].Path)
		}
	}
}

func TestManifestAtRef(t *testing.T) {
	dir := t.TempDir()
	m := NewManager()
	if err := m.Init(dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	man := &Manifest{
		Sources: []Source{{Alias: "Hospital", Database: "Hospital"}},
		Objects: map[string]ManifestObject{
			ObjectPath("Hospital", "dbo", "usp_Foo", "proc"): {Database: "Hospital", Schema: "dbo", Name: "usp_Foo", Type: "proc"},
		},
	}
	if err := m.WriteManifest(man); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if _, err := m.Commit("baseline", nil); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// mutate the worktree manifest after committing
	man.Sources = append(man.Sources, Source{Alias: "Pharmacy", Database: "Pharmacy"})
	if err := m.WriteManifest(man); err != nil {
		t.Fatalf("rewrite manifest: %v", err)
	}

	head, err := m.ManifestAtRef("HEAD")
	if err != nil {
		t.Fatalf("manifest at HEAD: %v", err)
	}
	if len(head.Sources) != 1 || head.Sources[0].Alias != "Hospital" {
		t.Errorf("HEAD sources = %+v, want [Hospital]", head.Sources)
	}
	if _, ok := head.Objects[ObjectPath("Hospital", "dbo", "usp_Foo", "proc")]; !ok {
		t.Errorf("HEAD manifest missing usp_Foo: %v", head.Objects)
	}

	working, err := m.ManifestAtRef("WORKING")
	if err != nil {
		t.Fatalf("manifest at WORKING: %v", err)
	}
	if len(working.Sources) != 2 {
		t.Errorf("WORKING sources = %+v, want 2 entries", working.Sources)
	}
}

// stubDriver answers the scripter's queries without a SQL Server: the module
// query returns the rows registered for the DSN, every other query returns
// none. That is enough to drive Compare end to end.
type stubDriver struct{}

// stubModules maps a DSN (here, a source alias) to sys.sql_modules rows:
// schema, name, type code, definition, create date, modify date.
var stubModules = map[string][][]driver.Value{}

func init() { sql.Register("gitrepo-stub", stubDriver{}) }

func (stubDriver) Open(dsn string) (driver.Conn, error) { return stubConn{rows: stubModules[dsn]}, nil }

type stubConn struct{ rows [][]driver.Value }

func (c stubConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "sys.sql_modules") {
		return &stubRows{cols: 6, rows: c.rows}, nil
	}
	return &stubRows{}, nil
}
func (stubConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("stub: Prepare unused") }
func (stubConn) Close() error                        { return nil }
func (stubConn) Begin() (driver.Tx, error)           { return nil, errors.New("stub: Begin unused") }

type stubRows struct {
	cols int
	rows [][]driver.Value
	pos  int
}

func (r *stubRows) Columns() []string { return make([]string, r.cols) }
func (r *stubRows) Close() error      { return nil }
func (r *stubRows) Next(dest []driver.Value) error {
	if r.pos >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.pos])
	r.pos++
	return nil
}

// Two sources on different servers may name the same database. Compare must
// select the repo side by alias: filtering by database name pulls the other
// source's objects into the diff and reports every one of them as missing.
func TestCompareDistinctAliasesSameDatabase(t *testing.T) {
	dir := t.TempDir()
	m := NewManager()
	if err := m.Init(dir); err != nil {
		t.Fatalf("init: %v", err)
	}

	const prodDef = "CREATE PROCEDURE dbo.usp_Foo AS SELECT 1"
	const devDef = "CREATE PROCEDURE dbo.usp_Foo AS SELECT 2"
	stubModules["Hospital"] = [][]driver.Value{{"dbo", "usp_Foo", "P", prodDef, "2024-01-01 00:00:00.000", "2024-01-01 00:00:00.000"}}
	stubModules["Hospital@dev"] = [][]driver.Value{{"dbo", "usp_Foo", "P", devDef, "2024-01-01 00:00:00.000", "2024-01-01 00:00:00.000"}}

	prodRel := ObjectPath("Hospital", "dbo", "usp_Foo", "proc")
	devRel := ObjectPath("Hospital@dev", "dbo", "usp_Foo", "proc")
	for rel, def := range map[string]string{prodRel: prodDef, devRel: devDef} {
		abs := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(db.NormalizeModule(def)), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	man := &Manifest{
		Sources: []Source{
			{Alias: "Hospital", Database: "Hospital", Server: "prod-sql"},
			{Alias: "Hospital@dev", Database: "Hospital", Server: "dev-sql"},
		},
		Objects: map[string]ManifestObject{
			prodRel: {Database: "Hospital", Schema: "dbo", Name: "usp_Foo", Type: "proc"},
			devRel:  {Alias: "Hospital@dev", Database: "Hospital", Schema: "dbo", Name: "usp_Foo", Type: "proc"},
		},
	}
	if err := m.WriteManifest(man); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Commit("baseline", nil); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var asked []string
	pools := map[string]*sql.DB{}
	for alias := range stubModules {
		pool, err := sql.Open("gitrepo-stub", alias)
		if err != nil {
			t.Fatal(err)
		}
		defer pool.Close()
		pools[alias] = pool
	}
	poolFor := func(alias string) (*sql.DB, error) {
		asked = append(asked, alias)
		return pools[alias], nil
	}

	res, err := m.Compare(context.Background(), poolFor, "HEAD", []string{"Hospital@dev"})
	if err != nil {
		t.Fatalf("compare: %v", err)
	}
	if len(asked) != 1 || asked[0] != "Hospital@dev" {
		t.Fatalf("pools requested = %v, want [Hospital@dev]", asked)
	}
	if len(res.Objects) != 1 {
		t.Fatalf("expected only the dev alias's object, got %d: %+v", len(res.Objects), res.Objects)
	}
	if o := res.Objects[0]; o.Path != devRel || o.State != StateIdentical || o.Database != "Hospital" {
		t.Errorf("dev object = %+v, want %s identical on database Hospital", o, devRel)
	}

	// an empty selector falls back to the source aliases, not the database
	// names — which would compare "Hospital" twice and never reach the dev tree
	asked = nil
	res, err = m.Compare(context.Background(), poolFor, "HEAD", nil)
	if err != nil {
		t.Fatalf("compare all: %v", err)
	}
	if len(asked) != 2 || asked[0] != "Hospital" || asked[1] != "Hospital@dev" {
		t.Fatalf("pools requested = %v, want [Hospital Hospital@dev]", asked)
	}
	states := map[string]string{}
	for _, o := range res.Objects {
		states[o.Path] = o.State
	}
	if len(res.Objects) != 2 || states[prodRel] != StateIdentical || states[devRel] != StateIdentical {
		t.Errorf("compare all = %+v, want both aliases identical", res.Objects)
	}
}
