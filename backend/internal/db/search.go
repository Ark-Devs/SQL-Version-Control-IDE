package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// SearchHit is one object matched by a global search.
type SearchHit struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Name     string `json:"name"`
	Type     string `json:"type"` // table | view | proc | tvf | scalar | trigger
	Match    string `json:"match"` // "name" | "definition"
	Snippet  string `json:"snippet"`
}

// SearchResult is the aggregate response across every database searched.
type SearchResult struct {
	Results   []SearchHit `json:"results"`
	Truncated bool        `json:"truncated"`
	Errors    []string    `json:"errors"`
}

const defaultMaxSearchResults = 200

const searchQuery = `
SELECT s.name, o.name, RTRIM(o.type),
       CASE WHEN o.name LIKE @p1 THEN 1 ELSE 0 END,
       ISNULL(m.definition, '')
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('U','V','P','FN','IF','TF','TR')
  AND (o.name LIKE @p1 OR (m.definition IS NOT NULL AND m.definition LIKE @p1))
ORDER BY s.name, o.name`

// escapeLike escapes LIKE wildcard characters ([, %, _) so a user's search
// text is matched literally, then the caller wraps it in %...% for a
// substring search.
func escapeLike(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '[', '%', '_':
			b.WriteByte('[')
			b.WriteRune(r)
			b.WriteByte(']')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// buildSnippet extracts ~60 characters of context around the first
// case-insensitive occurrence of q inside definition, collapsing newlines to
// spaces and marking truncation with '…'. Returns "" if q is not found.
func buildSnippet(definition, q string) string {
	if definition == "" || q == "" {
		return ""
	}
	idx := strings.Index(strings.ToLower(definition), strings.ToLower(q))
	if idx < 0 {
		return ""
	}
	const radius = 60
	start := idx - radius
	if start < 0 {
		start = 0
	}
	end := idx + len(q) + radius
	if end > len(definition) {
		end = len(definition)
	}
	// don't slice in the middle of a multi-byte rune
	for start > 0 && !utf8.RuneStart(definition[start]) {
		start--
	}
	for end < len(definition) && !utf8.RuneStart(definition[end]) {
		end++
	}
	snippet := strings.Join(strings.Fields(definition[start:end]), " ")
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(definition) {
		snippet += "…"
	}
	return snippet
}

// Search runs a name/definition search across the given databases, using
// poolFor to resolve a *sql.DB per database name. Results are capped at
// maxResults (across all databases combined); once reached, Truncated is set
// and no further databases are queried. A database that errors (permissions,
// offline, timeout) is recorded in Errors and does not fail the whole search.
func Search(ctx context.Context, poolFor func(database string) (*sql.DB, error), databases []string, q string, maxResults int) (*SearchResult, error) {
	if maxResults <= 0 {
		maxResults = defaultMaxSearchResults
	}
	pattern := "%" + escapeLike(q) + "%"
	result := &SearchResult{}

	for _, database := range databases {
		if len(result.Results) >= maxResults {
			result.Truncated = true
			break
		}

		pool, err := poolFor(database)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", database, err))
			continue
		}

		if searchOneDatabase(ctx, pool, database, pattern, q, maxResults, result) {
			result.Truncated = true
			break
		}
	}

	return result, nil
}

// searchOneDatabase runs the search query against a single database and
// appends hits to result. Returns true if the caller should stop searching
// further databases because maxResults was reached.
func searchOneDatabase(ctx context.Context, pool *sql.DB, database, pattern, q string, maxResults int, result *SearchResult) bool {
	dbCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	rows, err := pool.QueryContext(dbCtx, searchQuery, pattern)
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", database, err))
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var schema, name, typeCode, definition string
		var nameMatchInt int
		if err := rows.Scan(&schema, &name, &typeCode, &nameMatchInt, &definition); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", database, err))
			return false
		}

		match := "definition"
		if nameMatchInt != 0 {
			match = "name"
		}

		result.Results = append(result.Results, SearchHit{
			Database: database,
			Schema:   schema,
			Name:     name,
			Type:     objectTypeName(typeCode),
			Match:    match,
			Snippet:  buildSnippet(definition, q),
		})

		if len(result.Results) >= maxResults {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", database, err))
	}
	return false
}
