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
		database, schema, name, typ, want string
	}{
		{"Hospital", "dbo", "usp_Foo", "proc", "DB/Hospital/dbo/StoredProcedures/usp_Foo.sql"},
		{"Hospital", "dbo", "vw_Bar", "view", "DB/Hospital/dbo/Views/vw_Bar.sql"},
		{"Pharmacy", "sales", "tvf_X", "tvf", "DB/Pharmacy/sales/Functions/TableValued/tvf_X.sql"},
		{"Pharmacy", "dbo", "fn_Y", "scalar", "DB/Pharmacy/dbo/Functions/Scalar/fn_Y.sql"},
		{"Chan", "dbo", "Patients", "table", "DB/Chan/dbo/Tables/Patients.sql"},
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
