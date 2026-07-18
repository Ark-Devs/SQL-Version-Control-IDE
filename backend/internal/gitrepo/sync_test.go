package gitrepo

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"svcide/internal/db"
)

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"usp_GetPatient":   "usp_GetPatient",
		"weird/name":       "weird%2Fname",
		"q?a*b":            "q%3Fa%2Ab",
		"100%":             "100%25",
		"back\\slash":      "back%5Cslash",
		"col:on|pipe":      "col%3Aon%7Cpipe",
		"<angle>\"quote\"": "%3Cangle%3E%22quote%22",
	}
	for in, want := range cases {
		if got := sanitizeName(in); got != want {
			t.Errorf("sanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestObjectPath(t *testing.T) {
	cases := []struct {
		database, schema, name, typ, want string
	}{
		{"Hospital", "dbo", "usp_Foo", "proc", "SQL/Hospital/dbo/StoredProcedures/usp_Foo.sql"},
		{"Hospital", "dbo", "vw_Bar", "view", "SQL/Hospital/dbo/Views/vw_Bar.sql"},
		{"Pharmacy", "sales", "tvf_X", "tvf", "SQL/Pharmacy/sales/Functions/TableValued/tvf_X.sql"},
		{"Pharmacy", "dbo", "fn_Y", "scalar", "SQL/Pharmacy/dbo/Functions/Scalar/fn_Y.sql"},
		{"Chan", "dbo", "Patients", "table", "SQL/Chan/dbo/Tables/Patients.sql"},
	}
	for _, c := range cases {
		got := ObjectPath(c.database, c.schema, c.name, c.typ)
		if got != c.want {
			t.Errorf("ObjectPath(%q,%q,%q,%q) = %q, want %q", c.database, c.schema, c.name, c.typ, got, c.want)
		}
		if strings.Contains(got, "\\") {
			t.Errorf("path contains backslash: %q", got)
		}
	}
}
func TestMigrateLayout(t *testing.T) {
	dir := t.TempDir()
	m := NewManager()
	if err := m.Init(dir); err != nil {
		t.Fatalf("init: %v", err)
	}

	// legacy DB/ tree with one scripted object
	legacyFile := filepath.Join(dir, "DB", "Hospital", "dbo", "StoredProcedures", "usp_Foo.sql")
	if err := os.MkdirAll(filepath.Dir(legacyFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyFile, []byte("CREATE OR ALTER PROC dbo.usp_Foo AS SELECT 1"), 0o644); err != nil {
		t.Fatal(err)
	}
	man := &Manifest{
		Databases: []string{"Hospital"},
		Objects: map[string]ManifestObject{
			"DB/Hospital/dbo/StoredProcedures/usp_Foo.sql": {Database: "Hospital", Schema: "dbo", Name: "usp_Foo", Type: "proc"},
		},
	}
	if err := m.WriteManifest(man); err != nil {
		t.Fatal(err)
	}

	migrated, err := m.MigrateLayout()
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if !migrated {
		t.Fatal("expected migrated=true")
	}
	if _, err := os.Stat(filepath.Join(dir, "DB")); !os.IsNotExist(err) {
		t.Errorf("DB/ should be gone, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "SQL", "Hospital", "dbo", "StoredProcedures", "usp_Foo.sql")); err != nil {
		t.Errorf("SQL/ file missing: %v", err)
	}
	if !m.SQLFolderExists() {
		t.Error("SQLFolderExists should be true after migration")
	}
	got, err := m.ReadManifest()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got.Objects["SQL/Hospital/dbo/StoredProcedures/usp_Foo.sql"]; !ok {
		t.Errorf("manifest key not rewritten to SQL/: %v", got.Objects)
	}
	if _, ok := got.Objects["DB/Hospital/dbo/StoredProcedures/usp_Foo.sql"]; ok {
		t.Error("legacy DB/ manifest key still present")
	}

	// second call is a no-op (SQL/ already exists)
	again, err := m.MigrateLayout()
	if err != nil || again {
		t.Errorf("second MigrateLayout should be a no-op, got migrated=%v err=%v", again, err)
	}
}

func TestSyncObject(t *testing.T) {
	dir := t.TempDir()
	m := NewManager()
	if err := m.Init(dir); err != nil {
		t.Fatalf("init: %v", err)
	}
	man := &Manifest{Databases: []string{"Hospital"}, Objects: map[string]ManifestObject{}}

	read := func(rel string) (string, bool) {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			return "", false
		}
		return string(data), true
	}

	// 1. create: writes the file, upserts the manifest, canonical casing wins
	obj := &db.ScriptedObject{Schema: "dbo", Name: "usp_Foo", Type: "proc", SQL: "CREATE OR ALTER PROCEDURE dbo.usp_Foo AS SELECT 1\n"}
	res, err := m.SyncObject("Hospital", "DBO", "USP_FOO", obj, man) // request casing differs
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	rel := ObjectPath("Hospital", "dbo", "usp_Foo", "proc")
	if !res.Written || res.Path != rel {
		t.Fatalf("create result = %+v, want written path %s", res, rel)
	}
	if got, ok := read(rel); !ok || got != obj.SQL {
		t.Errorf("file not written correctly: %q ok=%v", got, ok)
	}
	if mo, ok := man.Objects[rel]; !ok || mo.Name != "usp_Foo" || mo.Type != "proc" {
		t.Errorf("manifest entry = %+v ok=%v", mo, ok)
	}

	// 2. alter: overwrites the file in place
	obj.SQL = "CREATE OR ALTER PROCEDURE dbo.usp_Foo AS SELECT 2\n"
	if _, err := m.SyncObject("Hospital", "dbo", "usp_Foo", obj, man); err != nil {
		t.Fatalf("alter: %v", err)
	}
	if got, _ := read(rel); got != obj.SQL {
		t.Errorf("alter did not overwrite: %q", got)
	}

	// 3. type change: same name becomes a view — old proc file/manifest entry go away
	viewObj := &db.ScriptedObject{Schema: "dbo", Name: "usp_Foo", Type: "view", SQL: "CREATE OR ALTER VIEW dbo.usp_Foo AS SELECT 1\n"}
	if _, err := m.SyncObject("Hospital", "dbo", "usp_Foo", viewObj, man); err != nil {
		t.Fatalf("type change: %v", err)
	}
	viewRel := ObjectPath("Hospital", "dbo", "usp_Foo", "view")
	if _, ok := read(rel); ok {
		t.Error("stale proc file should have been removed on type change")
	}
	if _, ok := read(viewRel); !ok {
		t.Error("view file missing after type change")
	}
	if _, ok := man.Objects[rel]; ok {
		t.Error("stale proc manifest entry still present")
	}
	if _, ok := man.Objects[viewRel]; !ok {
		t.Error("view manifest entry missing")
	}

	// 4. encrypted: skipped, nothing written
	enc := &db.ScriptedObject{Schema: "dbo", Name: "usp_Secret", Type: "proc", Encrypted: true}
	res, err = m.SyncObject("Hospital", "dbo", "usp_Secret", enc, man)
	if err != nil {
		t.Fatalf("encrypted: %v", err)
	}
	if !res.Skipped || !res.Encrypted || res.Written {
		t.Errorf("encrypted result = %+v, want skipped+encrypted", res)
	}
	if _, ok := man.Objects[ObjectPath("Hospital", "dbo", "usp_Secret", "proc")]; ok {
		t.Error("encrypted object should not be in the manifest")
	}

	// 5. drop: obj nil removes the file and the manifest entry
	res, err = m.SyncObject("Hospital", "dbo", "usp_Foo", nil, man)
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if !res.Deleted {
		t.Errorf("drop result = %+v, want deleted", res)
	}
	if _, ok := read(viewRel); ok {
		t.Error("view file should have been removed on drop")
	}
	if _, ok := man.Objects[viewRel]; ok {
		t.Error("manifest entry should have been pruned on drop")
	}
}

func TestObjectStatus(t *testing.T) {
	dir := t.TempDir()
	m := NewManager()
	if err := m.Init(dir); err != nil {
		t.Fatalf("init: %v", err)
	}

	writeObj := func(database, schema, name, typ, sql string) string {
		rel := ObjectPath(database, schema, name, typ)
		abs := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(sql), 0o644); err != nil {
			t.Fatal(err)
		}
		return rel
	}

	// baseline: two objects committed
	keptRel := writeObj("Hospital", "dbo", "usp_Kept", "proc", "CREATE PROC dbo.usp_Kept AS SELECT 1")
	droppedRel := writeObj("Hospital", "dbo", "usp_Dropped", "proc", "CREATE PROC dbo.usp_Dropped AS SELECT 1")
	man := &Manifest{
		Databases: []string{"Hospital"},
		Objects: map[string]ManifestObject{
			keptRel:    {Database: "Hospital", Schema: "dbo", Name: "usp_Kept", Type: "proc"},
			droppedRel: {Database: "Hospital", Schema: "dbo", Name: "usp_Dropped", Type: "proc"},
		},
	}
	if err := m.WriteManifest(man); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Commit("baseline", nil); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// no changes yet — status should be empty
	status, err := m.ObjectStatus()
	if err != nil {
		t.Fatalf("object status: %v", err)
	}
	if len(status) != 0 {
		t.Errorf("expected no status before changes, got %v", status)
	}

	// modify the kept object, drop the other, add a new one — simulating what
	// Sync does: rewrite the file(s) and prune the manifest for removed objects.
	if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(keptRel)), []byte("CREATE PROC dbo.usp_Kept AS SELECT 2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, filepath.FromSlash(droppedRel))); err != nil {
		t.Fatal(err)
	}
	newRel := writeObj("Hospital", "dbo", "usp_New", "proc", "CREATE PROC dbo.usp_New AS SELECT 3")

	// Sync rewrites the worktree manifest, dropping the removed object.
	man.Objects = map[string]ManifestObject{
		keptRel: {Database: "Hospital", Schema: "dbo", Name: "usp_Kept", Type: "proc"},
		newRel:  {Database: "Hospital", Schema: "dbo", Name: "usp_New", Type: "proc"},
	}
	if err := m.WriteManifest(man); err != nil {
		t.Fatal(err)
	}

	status, err = m.ObjectStatus()
	if err != nil {
		t.Fatalf("object status: %v", err)
	}

	if got := status["Hospital|dbo|usp_Kept"]; got.State != "modified" || got.Type != "proc" || got.Path != keptRel {
		t.Errorf("usp_Kept status = %+v, want modified/proc/%s", got, keptRel)
	}
	if got := status["Hospital|dbo|usp_New"]; got.State != "added" || got.Type != "proc" || got.Path != newRel {
		t.Errorf("usp_New status = %+v, want added/proc/%s", got, newRel)
	}
	// dropped object is gone from the worktree manifest — must be resolved via HEAD
	if got := status["Hospital|dbo|usp_Dropped"]; got.State != "deleted" || got.Type != "proc" || got.Path != droppedRel {
		t.Errorf("usp_Dropped status = %+v, want deleted/proc/%s", got, droppedRel)
	}
	// the manifest file itself changed too, but must not appear as an object
	if _, ok := status["Hospital|dbo|manifest.json"]; ok {
		t.Error("manifest.json path leaked into object status")
	}
	if len(status) != 3 {
		t.Errorf("expected exactly 3 objects in status, got %d: %v", len(status), status)
	}
}
