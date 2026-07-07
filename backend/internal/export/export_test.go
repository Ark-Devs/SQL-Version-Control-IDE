package export

import "testing"

func TestTypeSubfolder(t *testing.T) {
	cases := []struct {
		objType string
		want    string
		ok      bool
	}{
		{"proc", "sp", true},
		{"view", "views", true},
		{"scalar", "scalar functions", true},
		{"tvf", "table valued functions", true},
		{"trigger", "triggers", true},
		{"table", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := typeSubfolder(c.objType)
		if got != c.want || ok != c.ok {
			t.Errorf("typeSubfolder(%q) = (%q, %v), want (%q, %v)", c.objType, got, ok, c.want, c.ok)
		}
	}
}

func TestRelPathSingleDatabase(t *testing.T) {
	got := relPath(false, "Hospital", "sp", "dbo", "usp_Foo")
	want := "sql/sp/dbo.usp_Foo.sql"
	if got != want {
		t.Errorf("relPath() = %q, want %q", got, want)
	}
}

func TestRelPathMultiDatabase(t *testing.T) {
	got := relPath(true, "Hospital", "views", "dbo", "vw_Bar")
	want := "sql/Hospital/views/dbo.vw_Bar.sql"
	if got != want {
		t.Errorf("relPath() = %q, want %q", got, want)
	}
}

func TestRelPathSanitizesIllegalCharacters(t *testing.T) {
	// A schema/name pair containing a Windows-illegal character must be
	// %XX-escaped rather than rejected or silently stripped.
	got := relPath(false, "Hospital", "sp", "dbo", "weird:name")
	want := "sql/sp/dbo.weird%3Aname.sql"
	if got != want {
		t.Errorf("relPath() = %q, want %q", got, want)
	}
}

func TestSanitizeNameRoundTripsPlainNames(t *testing.T) {
	if got := sanitizeName("dbo.usp_Foo"); got != "dbo.usp_Foo" {
		t.Errorf("sanitizeName() = %q, want unchanged", got)
	}
}
