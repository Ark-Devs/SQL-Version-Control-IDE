package db

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// ScriptedObject is one database object rendered to a deterministic .sql file.
type ScriptedObject struct {
	Schema    string
	Name      string
	Type      string // table | view | proc | tvf | scalar | trigger
	SQL       string // normalized script
	Encrypted bool   // encrypted module: SQL is empty, surface a warning
}

// ScriptModules scripts every non-table programmable object (procs, views,
// functions, triggers) using its original source from sys.sql_modules.
func ScriptModules(ctx context.Context, pool *sql.DB) ([]ScriptedObject, error) {
	rows, err := pool.QueryContext(ctx, `
SELECT s.name, o.name, RTRIM(o.type), m.definition
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE o.type IN ('P','V','FN','IF','TF','TR') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScriptedObject
	for rows.Next() {
		var so ScriptedObject
		var typeCode string
		var def sql.NullString
		if err := rows.Scan(&so.Schema, &so.Name, &typeCode, &def); err != nil {
			return nil, err
		}
		so.Type = objectTypeName(typeCode)
		if !def.Valid {
			so.Encrypted = true
		} else {
			so.SQL = NormalizeModule(def.String)
		}
		out = append(out, so)
	}
	return out, rows.Err()
}

// headerRe matches the CREATE [OR ALTER] <kind> header of a module. It is
// applied at the first non-comment position of the script.
var headerRe = regexp.MustCompile(`(?i)^CREATE(\s+OR\s+ALTER)?(\s+)(PROC|PROCEDURE|VIEW|FUNCTION|TRIGGER)\b`)

// NormalizeModule makes module scripts deterministic and re-runnable:
// CRLF→LF, exactly one trailing newline, and the header rewritten to
// CREATE OR ALTER (idempotent — bodies are never touched).
func NormalizeModule(def string) string {
	s := strings.ReplaceAll(def, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")

	// find the first token position outside comments/whitespace
	pos := skipCommentsAndSpace(s)
	if m := headerRe.FindStringSubmatchIndex(s[pos:]); m != nil {
		kindStart, kindEnd := pos+m[6], pos+m[7]
		kind := strings.ToUpper(s[kindStart:kindEnd])
		if kind == "PROC" {
			kind = "PROCEDURE"
		}
		s = s[:pos] + "CREATE OR ALTER " + kind + s[kindEnd:]
	}

	s = strings.TrimRight(s, "\n \t") + "\n"
	return s
}

// skipCommentsAndSpace returns the index of the first byte that is not
// whitespace, a line comment, or a block comment.
func skipCommentsAndSpace(s string) int {
	i := 0
	for i < len(s) {
		switch {
		case s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r':
			i++
		case strings.HasPrefix(s[i:], "--"):
			nl := strings.IndexByte(s[i:], '\n')
			if nl < 0 {
				return len(s)
			}
			i += nl + 1
		case strings.HasPrefix(s[i:], "/*"):
			depth := 1
			j := i + 2
			for j < len(s) && depth > 0 {
				if strings.HasPrefix(s[j:], "/*") {
					depth++
					j += 2
				} else if strings.HasPrefix(s[j:], "*/") {
					depth--
					j += 2
				} else {
					j++
				}
			}
			i = j
		default:
			return i
		}
	}
	return i
}

// --- table scripting ---

type tableColumn struct {
	Name       string
	TypeName   string
	MaxLen     int
	Precision  int
	Scale      int
	Nullable   bool
	Identity   bool
	Seed       int64
	Increment  int64
	Computed   bool
	ComputedAs string
	Persisted  bool
	Default    string // constraint definition text, e.g. ((0))
}

type tableConstraint struct {
	Name      string
	Type      string // PK | UQ
	Clustered bool
	Columns   []string
}

type tableForeignKey struct {
	Name       string
	Columns    []string
	RefSchema  string
	RefTable   string
	RefColumns []string
	OnDelete   string
	OnUpdate   string
}

type tableCheck struct {
	Name       string
	Definition string
}

type tableIndex struct {
	Name     string
	Unique   bool
	Columns  []string // includes DESC suffix when needed
	Includes []string
}

// ScriptTables generates deterministic CREATE TABLE scripts for all user
// tables (bulk queries — no per-table round trips). Tables are tracked for
// history/diffing only; they are excluded from deploys.
func ScriptTables(ctx context.Context, pool *sql.DB) ([]ScriptedObject, error) {
	type key struct{ schema, table string }

	cols := map[key][]tableColumn{}
	constraints := map[key][]tableConstraint{}
	fks := map[key][]tableForeignKey{}
	checks := map[key][]tableCheck{}
	indexes := map[key][]tableIndex{}
	var order []key

	// columns (+identity, computed, defaults)
	rows, err := pool.QueryContext(ctx, `
SELECT s.name, tb.name, c.name, ty.name, c.max_length, c.precision, c.scale, c.is_nullable,
       c.is_identity, ISNULL(ic.seed_value, 0), ISNULL(ic.increment_value, 0),
       c.is_computed, ISNULL(cc.definition, ''), ISNULL(cc.is_persisted, 0), ISNULL(dc.definition, '')
FROM sys.tables tb
JOIN sys.schemas s ON tb.schema_id = s.schema_id
JOIN sys.columns c ON c.object_id = tb.object_id
JOIN sys.types ty ON c.user_type_id = ty.user_type_id
LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
WHERE tb.is_ms_shipped = 0
ORDER BY s.name, tb.name, c.column_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k key
		var c tableColumn
		var seed, incr sql.NullFloat64
		if err := rows.Scan(&k.schema, &k.table, &c.Name, &c.TypeName, &c.MaxLen, &c.Precision, &c.Scale,
			&c.Nullable, &c.Identity, &seed, &incr, &c.Computed, &c.ComputedAs, &c.Persisted, &c.Default); err != nil {
			rows.Close()
			return nil, err
		}
		c.Seed, c.Increment = int64(seed.Float64), int64(incr.Float64)
		if _, seen := cols[k]; !seen {
			order = append(order, k)
		}
		cols[k] = append(cols[k], c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// PK / unique constraints
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, tb.name, kc.name, kc.type, ISNULL(i.type, 0), c.name
FROM sys.key_constraints kc
JOIN sys.tables tb ON kc.parent_object_id = tb.object_id AND tb.is_ms_shipped = 0
JOIN sys.schemas s ON tb.schema_id = s.schema_id
JOIN sys.indexes i ON i.object_id = tb.object_id AND i.index_id = kc.unique_index_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
ORDER BY s.name, tb.name, kc.name, ic.key_ordinal`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k key
		var name, ctype string
		var idxType int
		var col string
		if err := rows.Scan(&k.schema, &k.table, &name, &ctype, &idxType, &col); err != nil {
			rows.Close()
			return nil, err
		}
		list := constraints[k]
		if len(list) == 0 || list[len(list)-1].Name != name {
			list = append(list, tableConstraint{Name: name, Type: strings.TrimSpace(ctype), Clustered: idxType == 1})
		}
		list[len(list)-1].Columns = append(list[len(list)-1].Columns, col)
		constraints[k] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// foreign keys
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, tb.name, fk.name, pc.name, rs.name, rt.name, rc.name,
       fk.delete_referential_action_desc, fk.update_referential_action_desc
FROM sys.foreign_keys fk
JOIN sys.tables tb ON fk.parent_object_id = tb.object_id AND tb.is_ms_shipped = 0
JOIN sys.schemas s ON tb.schema_id = s.schema_id
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY s.name, tb.name, fk.name, fkc.constraint_column_id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k key
		var name, pcol, rschema, rtable, rcol, onDel, onUpd string
		if err := rows.Scan(&k.schema, &k.table, &name, &pcol, &rschema, &rtable, &rcol, &onDel, &onUpd); err != nil {
			rows.Close()
			return nil, err
		}
		list := fks[k]
		if len(list) == 0 || list[len(list)-1].Name != name {
			list = append(list, tableForeignKey{Name: name, RefSchema: rschema, RefTable: rtable, OnDelete: onDel, OnUpdate: onUpd})
		}
		last := &list[len(list)-1]
		last.Columns = append(last.Columns, pcol)
		last.RefColumns = append(last.RefColumns, rcol)
		fks[k] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// check constraints
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, tb.name, ck.name, ck.definition
FROM sys.check_constraints ck
JOIN sys.tables tb ON ck.parent_object_id = tb.object_id AND tb.is_ms_shipped = 0
JOIN sys.schemas s ON tb.schema_id = s.schema_id
ORDER BY s.name, tb.name, ck.name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k key
		var c tableCheck
		if err := rows.Scan(&k.schema, &k.table, &c.Name, &c.Definition); err != nil {
			rows.Close()
			return nil, err
		}
		checks[k] = append(checks[k], c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// plain nonclustered indexes (not backing constraints)
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, tb.name, i.name, i.is_unique, c.name, ic.is_descending_key, ic.is_included_column
FROM sys.indexes i
JOIN sys.tables tb ON i.object_id = tb.object_id AND tb.is_ms_shipped = 0
JOIN sys.schemas s ON tb.schema_id = s.schema_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type > 0 AND i.name IS NOT NULL
ORDER BY s.name, tb.name, i.name, ic.is_included_column, ic.key_ordinal`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k key
		var name, col string
		var unique, desc, included bool
		if err := rows.Scan(&k.schema, &k.table, &name, &unique, &col, &desc, &included); err != nil {
			rows.Close()
			return nil, err
		}
		list := indexes[k]
		if len(list) == 0 || list[len(list)-1].Name != name {
			list = append(list, tableIndex{Name: name, Unique: unique})
		}
		last := &list[len(list)-1]
		if included {
			last.Includes = append(last.Includes, "["+col+"]")
		} else {
			col = "[" + col + "]"
			if desc {
				col += " DESC"
			}
			last.Columns = append(last.Columns, col)
		}
		indexes[k] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(order, func(a, b int) bool {
		if order[a].schema != order[b].schema {
			return order[a].schema < order[b].schema
		}
		return order[a].table < order[b].table
	})

	var out []ScriptedObject
	for _, k := range order {
		out = append(out, ScriptedObject{
			Schema: k.schema,
			Name:   k.table,
			Type:   "table",
			SQL:    renderTable(k.schema, k.table, cols[k], constraints[k], fks[k], checks[k], indexes[k]),
		})
	}
	return out, nil
}

func renderTable(schema, table string, cols []tableColumn, cons []tableConstraint, fks []tableForeignKey, checks []tableCheck, idxs []tableIndex) string {
	var b strings.Builder
	fmt.Fprintf(&b, "CREATE TABLE [%s].[%s] (\n", schema, table)

	var lines []string
	for _, c := range cols {
		if c.Computed {
			line := fmt.Sprintf("    [%s] AS %s", c.Name, c.ComputedAs)
			if c.Persisted {
				line += " PERSISTED"
			}
			lines = append(lines, line)
			continue
		}
		line := fmt.Sprintf("    [%s] %s", c.Name, FormatType(c.TypeName, c.MaxLen, c.Precision, c.Scale))
		if c.Identity {
			line += fmt.Sprintf(" IDENTITY(%d,%d)", c.Seed, c.Increment)
		}
		if c.Nullable {
			line += " NULL"
		} else {
			line += " NOT NULL"
		}
		if c.Default != "" {
			line += " DEFAULT " + c.Default
		}
		lines = append(lines, line)
	}
	for _, k := range cons {
		kind := "PRIMARY KEY"
		if k.Type == "UQ" {
			kind = "UNIQUE"
		}
		clustered := "NONCLUSTERED"
		if k.Clustered {
			clustered = "CLUSTERED"
		}
		lines = append(lines, fmt.Sprintf("    CONSTRAINT [%s] %s %s ([%s])", k.Name, kind, clustered, strings.Join(k.Columns, "], [")))
	}
	for _, fk := range fks {
		line := fmt.Sprintf("    CONSTRAINT [%s] FOREIGN KEY ([%s]) REFERENCES [%s].[%s] ([%s])",
			fk.Name, strings.Join(fk.Columns, "], ["), fk.RefSchema, fk.RefTable, strings.Join(fk.RefColumns, "], ["))
		if fk.OnDelete != "NO_ACTION" {
			line += " ON DELETE " + strings.ReplaceAll(fk.OnDelete, "_", " ")
		}
		if fk.OnUpdate != "NO_ACTION" {
			line += " ON UPDATE " + strings.ReplaceAll(fk.OnUpdate, "_", " ")
		}
		lines = append(lines, line)
	}
	for _, ck := range checks {
		lines = append(lines, fmt.Sprintf("    CONSTRAINT [%s] CHECK %s", ck.Name, ck.Definition))
	}
	b.WriteString(strings.Join(lines, ",\n"))
	b.WriteString("\n);\n")

	for _, ix := range idxs {
		unique := ""
		if ix.Unique {
			unique = "UNIQUE "
		}
		fmt.Fprintf(&b, "\nCREATE %sNONCLUSTERED INDEX [%s] ON [%s].[%s] (%s)", unique, ix.Name, schema, table, strings.Join(ix.Columns, ", "))
		if len(ix.Includes) > 0 {
			fmt.Fprintf(&b, " INCLUDE (%s)", strings.Join(ix.Includes, ", "))
		}
		b.WriteString(";\n")
	}
	return b.String()
}
