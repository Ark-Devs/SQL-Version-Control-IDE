package db

import (
	"context"
	"database/sql"
	"sync"
)

// AutocompleteData is the compact schema payload the editor's completion
// provider consumes.
type AutocompleteData struct {
	Tables []AcTable `json:"tables"`
	Procs  []AcProc  `json:"procs"`
	Funcs  []AcProc  `json:"funcs"`
}

type AcTable struct {
	Schema  string     `json:"s"`
	Name    string     `json:"n"`
	IsView  bool       `json:"v,omitempty"`
	Columns []AcColumn `json:"cols"`
}

type AcColumn struct {
	Name string `json:"n"`
	Type string `json:"t"`
}

type AcProc struct {
	Schema string     `json:"s"`
	Name   string     `json:"n"`
	Params []AcColumn `json:"params,omitempty"`
}

// AcCache caches autocomplete payloads per connection+database.
type AcCache struct {
	mu    sync.Mutex
	items map[string]*AutocompleteData
}

func NewAcCache() *AcCache {
	return &AcCache{items: map[string]*AutocompleteData{}}
}

func (c *AcCache) Get(ctx context.Context, key string, pool *sql.DB, refresh bool) (*AutocompleteData, error) {
	c.mu.Lock()
	if !refresh {
		if d, ok := c.items[key]; ok {
			c.mu.Unlock()
			return d, nil
		}
	}
	c.mu.Unlock()

	d, err := loadAutocomplete(ctx, pool)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.items[key] = d
	c.mu.Unlock()
	return d, nil
}

func loadAutocomplete(ctx context.Context, pool *sql.DB) (*AutocompleteData, error) {
	out := &AutocompleteData{}

	// tables + views with columns, one round trip
	rows, err := pool.QueryContext(ctx, `
SELECT s.name, o.name, CASE WHEN o.type = 'V' THEN 1 ELSE 0 END, c.name, t.name
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
JOIN sys.columns c ON c.object_id = o.object_id
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE o.type IN ('U','V') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, c.column_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var schema, name, colName, colType string
		var isView bool
		if err := rows.Scan(&schema, &name, &isView, &colName, &colType); err != nil {
			rows.Close()
			return nil, err
		}
		if len(out.Tables) == 0 || out.Tables[len(out.Tables)-1].Schema != schema || out.Tables[len(out.Tables)-1].Name != name {
			out.Tables = append(out.Tables, AcTable{Schema: schema, Name: name, IsView: isView})
		}
		last := &out.Tables[len(out.Tables)-1]
		last.Columns = append(last.Columns, AcColumn{Name: colName, Type: colType})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// procs + functions with parameters
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, o.name, RTRIM(o.type), ISNULL(p.name, ''), ISNULL(t.name, '')
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.parameters p ON p.object_id = o.object_id AND p.parameter_id > 0
LEFT JOIN sys.types t ON p.user_type_id = t.user_type_id
WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name, p.parameter_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var schema, name, typeCode, paramName, paramType string
		if err := rows.Scan(&schema, &name, &typeCode, &paramName, &paramType); err != nil {
			return nil, err
		}
		list := &out.Procs
		if typeCode != "P" {
			list = &out.Funcs
		}
		if len(*list) == 0 || (*list)[len(*list)-1].Schema != schema || (*list)[len(*list)-1].Name != name {
			*list = append(*list, AcProc{Schema: schema, Name: name})
		}
		if paramName != "" {
			last := &(*list)[len(*list)-1]
			last.Params = append(last.Params, AcColumn{Name: paramName, Type: paramType})
		}
	}
	return out, rows.Err()
}
