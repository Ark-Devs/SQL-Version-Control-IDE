package db

import (
	"strings"
	"testing"
)

func TestNormalizeModuleHeaderRewrite(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string // expected prefix of first non-comment content
	}{
		{"plain create proc", "CREATE PROCEDURE dbo.Foo AS SELECT 1", "CREATE OR ALTER PROCEDURE"},
		{"proc shorthand", "CREATE PROC dbo.Foo AS SELECT 1", "CREATE OR ALTER PROCEDURE"},
		{"already or alter", "CREATE OR ALTER PROCEDURE dbo.Foo AS SELECT 1", "CREATE OR ALTER PROCEDURE"},
		{"lowercase", "create procedure dbo.Foo as select 1", "CREATE OR ALTER PROCEDURE"},
		{"view", "CREATE VIEW dbo.V AS SELECT 1 AS x", "CREATE OR ALTER VIEW"},
		{"function", "CREATE FUNCTION dbo.F() RETURNS INT AS BEGIN RETURN 1 END", "CREATE OR ALTER FUNCTION"},
		{"trigger", "CREATE TRIGGER trg ON dbo.T AFTER INSERT AS SELECT 1", "CREATE OR ALTER TRIGGER"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NormalizeModule(c.in)
			if !strings.HasPrefix(got, c.want) {
				t.Fatalf("want prefix %q, got %q", c.want, got)
			}
		})
	}
}

func TestNormalizeModuleLeadingComments(t *testing.T) {
	in := "-- comment mentioning CREATE PROCEDURE\n/* block\ncomment */\nCREATE PROCEDURE dbo.Foo AS SELECT 1"
	got := NormalizeModule(in)
	if !strings.Contains(got, "-- comment mentioning CREATE PROCEDURE") {
		t.Fatalf("comment lost: %q", got)
	}
	if !strings.Contains(got, "CREATE OR ALTER PROCEDURE dbo.Foo") {
		t.Fatalf("header not rewritten: %q", got)
	}
	if strings.Contains(got, "CREATE OR ALTER PROCEDURE\n/* block") {
		t.Fatalf("rewrote inside comment: %q", got)
	}
}

func TestNormalizeModuleIdempotent(t *testing.T) {
	inputs := []string{
		"CREATE PROCEDURE dbo.Foo AS\r\nSELECT 1\r\n",
		"  \n-- header\nCREATE VIEW dbo.V AS SELECT 1 AS x",
		"CREATE OR ALTER FUNCTION dbo.F() RETURNS INT AS BEGIN RETURN 1 END\n\n\n",
	}
	for _, in := range inputs {
		once := NormalizeModule(in)
		twice := NormalizeModule(once)
		if once != twice {
			t.Fatalf("not idempotent:\nonce:  %q\ntwice: %q", once, twice)
		}
		if !strings.HasSuffix(once, "\n") || strings.HasSuffix(once, "\n\n") {
			t.Fatalf("trailing newline wrong: %q", once)
		}
		if strings.Contains(once, "\r") {
			t.Fatalf("CR remained: %q", once)
		}
	}
}

func TestNormalizeModuleBodyUntouched(t *testing.T) {
	body := "CREATE PROCEDURE dbo.Foo AS\nBEGIN\n    SELECT 'CREATE PROCEDURE inside string'\n    -- CREATE VIEW in comment\nEND"
	got := NormalizeModule(body)
	if !strings.Contains(got, "SELECT 'CREATE PROCEDURE inside string'") {
		t.Fatalf("string literal modified: %q", got)
	}
	if !strings.Contains(got, "-- CREATE VIEW in comment") {
		t.Fatalf("comment modified: %q", got)
	}
	if strings.Count(got, "CREATE OR ALTER") != 1 {
		t.Fatalf("rewrote more than the header: %q", got)
	}
}
