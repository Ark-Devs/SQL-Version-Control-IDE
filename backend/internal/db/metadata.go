package db

import (
	"context"
	"database/sql"
	"fmt"
)

type DatabaseInfo struct {
	Name string `json:"name"`
}

type ObjectInfo struct {
	Schema     string `json:"schema"`
	Name       string `json:"name"`
	Type       string `json:"type"` // table | view | proc | tvf | scalar | trigger
	ObjectID   int64  `json:"objectId"`
	ModifyDate string `json:"modifyDate"`
}

type ColumnInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // display type, e.g. varchar(50)
	Nullable bool   `json:"nullable"`
	Identity bool   `json:"identity"`
	Computed bool   `json:"computed"`
}

type IndexInfo struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Unique  bool     `json:"unique"`
	Primary bool     `json:"primary"`
	Columns []string `json:"columns"`
}

type Definition struct {
	Definition string `json:"definition"`
	Encrypted  bool   `json:"encrypted"`
}

// objectTypeName maps sys.objects.type codes to our type slugs.
func objectTypeName(code string) string {
	switch code {
	case "U":
		return "table"
	case "V":
		return "view"
	case "P":
		return "proc"
	case "IF", "TF":
		return "tvf"
	case "FN":
		return "scalar"
	case "TR":
		return "trigger"
	}
	return code
}

func ListDatabases(ctx context.Context, pool *sql.DB) ([]DatabaseInfo, error) {
	rows, err := pool.QueryContext(ctx,
		`SELECT name FROM sys.databases WHERE state = 0 ORDER BY CASE WHEN database_id <= 4 THEN 1 ELSE 0 END, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DatabaseInfo
	for rows.Next() {
		var d DatabaseInfo
		if err := rows.Scan(&d.Name); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func ListObjects(ctx context.Context, pool *sql.DB) ([]ObjectInfo, error) {
	rows, err := pool.QueryContext(ctx, `
SELECT s.name, o.name, RTRIM(o.type), o.object_id, CONVERT(varchar(19), o.modify_date, 120)
FROM sys.objects o
JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN ('U','V','P','FN','IF','TF') AND o.is_ms_shipped = 0
ORDER BY s.name, o.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ObjectInfo
	for rows.Next() {
		var o ObjectInfo
		var typeCode string
		if err := rows.Scan(&o.Schema, &o.Name, &typeCode, &o.ObjectID, &o.ModifyDate); err != nil {
			return nil, err
		}
		o.Type = objectTypeName(typeCode)
		out = append(out, o)
	}
	return out, rows.Err()
}

func ListColumns(ctx context.Context, pool *sql.DB, schema, name string) ([]ColumnInfo, error) {
	rows, err := pool.QueryContext(ctx, `
SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
ORDER BY c.column_id`, schema, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ColumnInfo
	for rows.Next() {
		var c ColumnInfo
		var typeName string
		var maxLen, precision, scale int
		if err := rows.Scan(&c.Name, &typeName, &maxLen, &precision, &scale, &c.Nullable, &c.Identity, &c.Computed); err != nil {
			return nil, err
		}
		c.Type = FormatType(typeName, maxLen, precision, scale)
		out = append(out, c)
	}
	return out, rows.Err()
}

// FormatType renders a display type like SSMS: varchar(50), decimal(18,2).
func FormatType(name string, maxLen, precision, scale int) string {
	switch name {
	case "varchar", "char", "varbinary", "binary":
		if maxLen == -1 {
			return name + "(max)"
		}
		return fmt.Sprintf("%s(%d)", name, maxLen)
	case "nvarchar", "nchar":
		if maxLen == -1 {
			return name + "(max)"
		}
		return fmt.Sprintf("%s(%d)", name, maxLen/2)
	case "decimal", "numeric":
		return fmt.Sprintf("%s(%d,%d)", name, precision, scale)
	case "datetime2", "datetimeoffset", "time":
		return fmt.Sprintf("%s(%d)", name, scale)
	}
	return name
}

func ListIndexes(ctx context.Context, pool *sql.DB, schema, name string) ([]IndexInfo, error) {
	rows, err := pool.QueryContext(ctx, `
SELECT i.name, i.type_desc, i.is_unique, i.is_primary_key, c.name
FROM sys.indexes i
JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2)) AND i.name IS NOT NULL
ORDER BY i.index_id, ic.key_ordinal`, schema, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IndexInfo
	byName := map[string]*IndexInfo{}
	for rows.Next() {
		var idxName, typeDesc, colName string
		var unique, primary bool
		if err := rows.Scan(&idxName, &typeDesc, &unique, &primary, &colName); err != nil {
			return nil, err
		}
		idx, ok := byName[idxName]
		if !ok {
			out = append(out, IndexInfo{Name: idxName, Type: typeDesc, Unique: unique, Primary: primary})
			idx = &out[len(out)-1]
			byName[idxName] = idx
		}
		idx.Columns = append(idx.Columns, colName)
	}
	return out, rows.Err()
}

// GetDefinition returns the T-SQL source of a module (proc/view/function/trigger).
// Encrypted modules have a NULL definition.
func GetDefinition(ctx context.Context, pool *sql.DB, schema, name string) (Definition, error) {
	var def sql.NullString
	err := pool.QueryRowContext(ctx, `
SELECT m.definition
FROM sys.sql_modules m
WHERE m.object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))`, schema, name).Scan(&def)
	if err == sql.ErrNoRows {
		return Definition{}, fmt.Errorf("object %s.%s not found or has no module", schema, name)
	}
	if err != nil {
		return Definition{}, err
	}
	if !def.Valid {
		return Definition{Encrypted: true}, nil
	}
	return Definition{Definition: def.String}, nil
}
