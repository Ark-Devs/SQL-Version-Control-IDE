package db

import (
	"strings"
	"testing"
)

func TestSplitBatches(t *testing.T) {
	cases := []struct {
		name   string
		script string
		want   int
	}{
		{"no separator", "SELECT 1", 1},
		{"simple", "SELECT 1\nGO\nSELECT 2", 2},
		{"case insensitive + count", "SELECT 1\ngo 5\nSELECT 2\nGO", 2},
		{"crlf", "SELECT 1\r\nGO\r\nSELECT 2", 2},
		{"go with trailing comment", "SELECT 1\nGO -- run it\nSELECT 2", 2},
		{"go inside string", "SELECT 'a\nGO\nb'", 1},
		{"go inside block comment", "SELECT 1 /*\nGO\n*/ + 2", 1},
		{"nested block comment", "/* outer /* inner */\nGO\n*/ SELECT 1", 1},
		{"go inside line comment is separator line", "SELECT 1 -- GO\nGO\nSELECT 2", 2},
		{"goto is not go", "SELECT 1\nGOTO label\nGO", 1},
		{"leading whitespace", "SELECT 1\n   GO   \nSELECT 2", 2},
		{"empty batches dropped", "GO\nGO\nSELECT 1\nGO\n\nGO", 1},
		{"bracket identifier", "SELECT [a\nGO\nb] FROM t", 1},
		{"string with escaped quote", "SELECT 'it''s\nGO\nfine'", 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := SplitBatches(c.script)
			if len(got) != c.want {
				t.Fatalf("want %d batches, got %d: %q", c.want, len(got), got)
			}
		})
	}
}

func TestSplitBatchesContent(t *testing.T) {
	got := SplitBatches("SELECT 1\nGO\nSELECT 2")
	if !strings.Contains(got[0], "SELECT 1") || !strings.Contains(got[1], "SELECT 2") {
		t.Fatalf("unexpected batch content: %q", got)
	}
	if strings.Contains(got[0], "GO") || strings.Contains(got[1], "GO") {
		t.Fatalf("GO leaked into batch: %q", got)
	}
}
