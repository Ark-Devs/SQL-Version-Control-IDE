package gitrepo

import (
	"strings"
	"testing"
)

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"usp_GetPatient":  "usp_GetPatient",
		"weird/name":      "weird%2Fname",
		"q?a*b":           "q%3Fa%2Ab",
		"100%":            "100%25",
		"back\\slash":     "back%5Cslash",
		"col:on|pipe":     "col%3Aon%7Cpipe",
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
		schema, name, typ, want string
	}{
		{"dbo", "usp_Foo", "proc", "dbo/StoredProcedures/usp_Foo.sql"},
		{"dbo", "vw_Bar", "view", "dbo/Views/vw_Bar.sql"},
		{"sales", "tvf_X", "tvf", "sales/Functions/TableValued/tvf_X.sql"},
		{"dbo", "fn_Y", "scalar", "dbo/Functions/Scalar/fn_Y.sql"},
		{"dbo", "Patients", "table", "dbo/Tables/Patients.sql"},
	}
	for _, c := range cases {
		got := ObjectPath(c.schema, c.name, c.typ)
		if got != c.want {
			t.Errorf("ObjectPath(%q,%q,%q) = %q, want %q", c.schema, c.name, c.typ, got, c.want)
		}
		if strings.Contains(got, "\\") {
			t.Errorf("path contains backslash: %q", got)
		}
	}
}
