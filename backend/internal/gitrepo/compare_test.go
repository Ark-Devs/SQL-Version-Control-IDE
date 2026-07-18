package gitrepo

import (
	"testing"
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
		Databases: []string{"Hospital"},
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
	man.Databases = append(man.Databases, "Pharmacy")
	if err := m.WriteManifest(man); err != nil {
		t.Fatalf("rewrite manifest: %v", err)
	}

	head, err := m.ManifestAtRef("HEAD")
	if err != nil {
		t.Fatalf("manifest at HEAD: %v", err)
	}
	if len(head.Databases) != 1 || head.Databases[0] != "Hospital" {
		t.Errorf("HEAD databases = %v, want [Hospital]", head.Databases)
	}
	if _, ok := head.Objects[ObjectPath("Hospital", "dbo", "usp_Foo", "proc")]; !ok {
		t.Errorf("HEAD manifest missing usp_Foo: %v", head.Objects)
	}

	working, err := m.ManifestAtRef("WORKING")
	if err != nil {
		t.Fatalf("manifest at WORKING: %v", err)
	}
	if len(working.Databases) != 2 {
		t.Errorf("WORKING databases = %v, want 2 entries", working.Databases)
	}
}
