package db

import (
	"context"
	"database/sql"
)

// DbExtras is everything the deep explorer tree needs beyond the core object
// list, fetched in one request and cached client-side.
type DbExtras struct {
	Synonyms   []Synonym              `json:"synonyms"`
	DbTriggers []DbTrigger            `json:"dbTriggers"` // database-level DDL triggers
	DataTypes  []UserType             `json:"dataTypes"`
	TableTypes []UserType             `json:"tableTypes"`
	Sequences  []Sequence             `json:"sequences"`
	Users      []Principal            `json:"users"`
	Roles      []Principal            `json:"roles"`
	Schemas    []string               `json:"schemas"`
	Params     map[string][]ParamInfo `json:"params"` // "schema.name" → parameters
}

type Synonym struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Base   string `json:"base"` // base_object_name
}

type DbTrigger struct {
	Name     string `json:"name"`
	Disabled bool   `json:"disabled"`
}

type UserType struct {
	Schema   string `json:"schema"`
	Name     string `json:"name"`
	BaseType string `json:"baseType,omitempty"`
	Nullable bool   `json:"nullable"`
}

type Sequence struct {
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Start     string `json:"start"`
	Increment string `json:"increment"`
	Current   string `json:"current"`
}

type Principal struct {
	Name string `json:"name"`
	Type string `json:"type"` // SQL_USER, WINDOWS_USER, DATABASE_ROLE, …
}

type ParamInfo struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Output bool   `json:"output"`
}

// LoadExtras gathers the deep-tree metadata for one database.
func LoadExtras(ctx context.Context, pool *sql.DB) (*DbExtras, error) {
	out := &DbExtras{Params: map[string][]ParamInfo{}}

	// synonyms
	rows, err := pool.QueryContext(ctx, `
SELECT s.name, sy.name, sy.base_object_name
FROM sys.synonyms sy JOIN sys.schemas s ON sy.schema_id = s.schema_id
ORDER BY s.name, sy.name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s Synonym
		if err := rows.Scan(&s.Schema, &s.Name, &s.Base); err != nil {
			rows.Close()
			return nil, err
		}
		out.Synonyms = append(out.Synonyms, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// database-level DDL triggers
	rows, err = pool.QueryContext(ctx,
		`SELECT name, is_disabled FROM sys.triggers WHERE parent_class = 0 ORDER BY name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t DbTrigger
		if err := rows.Scan(&t.Name, &t.Disabled); err != nil {
			rows.Close()
			return nil, err
		}
		out.DbTriggers = append(out.DbTriggers, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// user-defined types (plain + table types)
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, t.name, ISNULL(bt.name, ''), t.is_nullable, t.is_table_type,
       t.max_length, t.precision, t.scale
FROM sys.types t
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.types bt ON bt.user_type_id = t.system_type_id AND bt.is_user_defined = 0
WHERE t.is_user_defined = 1
ORDER BY s.name, t.name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var ut UserType
		var isTableType bool
		var maxLen, precision, scale int
		if err := rows.Scan(&ut.Schema, &ut.Name, &ut.BaseType, &ut.Nullable, &isTableType, &maxLen, &precision, &scale); err != nil {
			rows.Close()
			return nil, err
		}
		if ut.BaseType != "" {
			ut.BaseType = FormatType(ut.BaseType, maxLen, precision, scale)
		}
		if isTableType {
			out.TableTypes = append(out.TableTypes, ut)
		} else {
			out.DataTypes = append(out.DataTypes, ut)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// sequences
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, sq.name, TYPE_NAME(sq.user_type_id),
       CONVERT(varchar(40), sq.start_value), CONVERT(varchar(40), sq.increment), CONVERT(varchar(40), sq.current_value)
FROM sys.sequences sq JOIN sys.schemas s ON sq.schema_id = s.schema_id
ORDER BY s.name, sq.name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sq Sequence
		if err := rows.Scan(&sq.Schema, &sq.Name, &sq.Type, &sq.Start, &sq.Increment, &sq.Current); err != nil {
			rows.Close()
			return nil, err
		}
		out.Sequences = append(out.Sequences, sq)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// users + roles
	rows, err = pool.QueryContext(ctx, `
SELECT name, type_desc, type
FROM sys.database_principals
WHERE type IN ('S','U','G','E','X','R') AND name NOT LIKE '##%' AND name NOT IN ('INFORMATION_SCHEMA','sys')
ORDER BY name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p Principal
		var typeCode string
		if err := rows.Scan(&p.Name, &p.Type, &typeCode); err != nil {
			rows.Close()
			return nil, err
		}
		if typeCode == "R" {
			out.Roles = append(out.Roles, p)
		} else {
			out.Users = append(out.Users, p)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// schemas
	rows, err = pool.QueryContext(ctx, `
SELECT name FROM sys.schemas
WHERE schema_id < 16384 AND name NOT IN ('sys','INFORMATION_SCHEMA','guest')
ORDER BY name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, err
		}
		out.Schemas = append(out.Schemas, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// parameters for procs + functions, one round trip
	rows, err = pool.QueryContext(ctx, `
SELECT s.name, o.name, p.name, TYPE_NAME(p.user_type_id), p.max_length, p.precision, p.scale, p.is_output
FROM sys.parameters p
JOIN sys.objects o ON p.object_id = o.object_id
JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0 AND p.parameter_id > 0
ORDER BY s.name, o.name, p.parameter_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var schema, obj, pname string
		var ptype sql.NullString
		var maxLen, precision, scale int
		var output bool
		if err := rows.Scan(&schema, &obj, &pname, &ptype, &maxLen, &precision, &scale, &output); err != nil {
			return nil, err
		}
		key := schema + "." + obj
		typeName := ""
		if ptype.Valid {
			typeName = FormatType(ptype.String, maxLen, precision, scale)
		}
		out.Params[key] = append(out.Params[key], ParamInfo{Name: pname, Type: typeName, Output: output})
	}
	return out, rows.Err()
}

// TableDetail is the per-table deep-tree payload (columns and indexes have
// their own endpoints already).
type TableDetail struct {
	Keys        []TableKey        `json:"keys"`
	Constraints []TableConstraint `json:"constraints"`
	Triggers    []DbTrigger       `json:"triggers"`
}

type TableKey struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"` // PK | UQ | FK
	Detail string `json:"detail"`
}

type TableConstraint struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"` // DEFAULT | CHECK
	Definition string `json:"definition"`
}

// LoadTableDetail fetches keys, constraints and triggers for one table.
func LoadTableDetail(ctx context.Context, pool *sql.DB, schema, name string) (*TableDetail, error) {
	out := &TableDetail{}

	// PK / unique keys with column lists
	rows, err := pool.QueryContext(ctx, `
SELECT kc.name, RTRIM(kc.type),
       STUFF((SELECT ', ' + c.name
              FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id AND ic.is_included_column = 0
              ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '')
FROM sys.key_constraints kc
WHERE kc.parent_object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
ORDER BY kc.name`, schema, name)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k TableKey
		if err := rows.Scan(&k.Name, &k.Kind, &k.Detail); err != nil {
			rows.Close()
			return nil, err
		}
		out.Keys = append(out.Keys, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// foreign keys with referenced table
	rows, err = pool.QueryContext(ctx, `
SELECT fk.name, rs.name + '.' + rt.name
FROM sys.foreign_keys fk
JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
WHERE fk.parent_object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
ORDER BY fk.name`, schema, name)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k TableKey
		k.Kind = "FK"
		if err := rows.Scan(&k.Name, &k.Detail); err != nil {
			rows.Close()
			return nil, err
		}
		out.Keys = append(out.Keys, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// default + check constraints
	rows, err = pool.QueryContext(ctx, `
SELECT dc.name, 'DEFAULT', c.name + ' = ' + dc.definition
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
UNION ALL
SELECT ck.name, 'CHECK', ck.definition
FROM sys.check_constraints ck
WHERE ck.parent_object_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
ORDER BY 1`, schema, name)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c TableConstraint
		if err := rows.Scan(&c.Name, &c.Kind, &c.Definition); err != nil {
			rows.Close()
			return nil, err
		}
		out.Constraints = append(out.Constraints, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// DML triggers on the table
	rows, err = pool.QueryContext(ctx, `
SELECT name, is_disabled FROM sys.triggers
WHERE parent_id = OBJECT_ID(QUOTENAME(@p1) + '.' + QUOTENAME(@p2))
ORDER BY name`, schema, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t DbTrigger
		if err := rows.Scan(&t.Name, &t.Disabled); err != nil {
			return nil, err
		}
		out.Triggers = append(out.Triggers, t)
	}
	return out, rows.Err()
}
