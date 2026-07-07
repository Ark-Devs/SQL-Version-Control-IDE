package db

import (
	"strings"
	"testing"
)

func TestEscapeLike(t *testing.T) {
	cases := []struct{ in, want string }{
		{"usp_Foo", "usp[_]Foo"},
		{"100%", "100[%]"},
		// only [, %, _ are special in LIKE; a lone ']' needs no escaping
		{"[test]", "[[]test]"},
		{"plain", "plain"},
		{"a_b%c[d]", "a[_]b[%]c[[]d]"},
	}
	for _, c := range cases {
		if got := escapeLike(c.in); got != c.want {
			t.Errorf("escapeLike(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildSnippetFindsAndTrims(t *testing.T) {
	def := "CREATE PROCEDURE dbo.Foo\nAS\nBEGIN\n  SELECT * FROM Bar WHERE NeedleColumn = 1\nEND"
	got := buildSnippet(def, "NeedleColumn")
	if got == "" {
		t.Fatal("expected a snippet, got empty string")
	}
	if !strings.Contains(got, "NeedleColumn") {
		t.Fatalf("snippet %q does not contain the search term", got)
	}
	if strings.Contains(got, "\n") {
		t.Fatalf("snippet %q still contains a newline", got)
	}
}

func TestBuildSnippetNoMatch(t *testing.T) {
	if got := buildSnippet("CREATE VIEW dbo.V AS SELECT 1", "notpresent"); got != "" {
		t.Fatalf("expected empty snippet, got %q", got)
	}
}

func TestBuildSnippetEllipsis(t *testing.T) {
	long := "SELECT 1 -- " + strings.Repeat("x", 200) + "NEEDLE" + strings.Repeat("y", 200)
	got := buildSnippet(long, "NEEDLE")
	if !strings.HasPrefix(got, "…") {
		t.Fatalf("expected leading ellipsis, got %q", got)
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("expected trailing ellipsis, got %q", got)
	}
}

func TestBuildSnippetShortDefinitionNoEllipsis(t *testing.T) {
	got := buildSnippet("SELECT NEEDLE FROM t", "NEEDLE")
	if strings.HasPrefix(got, "…") || strings.HasSuffix(got, "…") {
		t.Fatalf("did not expect ellipsis for a short definition, got %q", got)
	}
}

func TestBuildSnippetCaseInsensitive(t *testing.T) {
	if got := buildSnippet("select * from Foo where X = 1", "FOO"); got == "" {
		t.Fatal("expected case-insensitive match to find a snippet")
	}
}

func TestBuildSnippetEmptyInputs(t *testing.T) {
	if got := buildSnippet("", "x"); got != "" {
		t.Fatalf("expected empty snippet for empty definition, got %q", got)
	}
	if got := buildSnippet("SELECT 1", ""); got != "" {
		t.Fatalf("expected empty snippet for empty query, got %q", got)
	}
}
