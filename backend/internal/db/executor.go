package db

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/golang-sql/sqlexp"
	"github.com/google/uuid"
)

const maxRowsPerSet = 10000

type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type ResultSet struct {
	Columns   []Column `json:"columns"`
	Rows      [][]any  `json:"rows"`
	Truncated bool     `json:"truncated"`
}

type Message struct {
	Kind string `json:"kind"` // info | error | rowcount
	Text string `json:"text"`
}

type Snapshot struct {
	Done      bool         `json:"done"`
	Sets      []*ResultSet `json:"sets"`
	Messages  []Message    `json:"messages"`
	ElapsedMs int64        `json:"elapsedMs"`
	Error     string       `json:"error,omitempty"`
}

type Execution struct {
	id      string
	mu      sync.Mutex
	sets    []*ResultSet
	msgs    []Message
	done    bool
	errText string
	started time.Time
	elapsed time.Duration
	cancel  context.CancelFunc
}

// Manager tracks running and completed executions until the client releases them.
type Manager struct {
	mu    sync.Mutex
	execs map[string]*Execution
}

func NewManager() *Manager {
	return &Manager{execs: map[string]*Execution{}}
}

// Start begins executing a script on its own dedicated connection from the pool.
func (m *Manager) Start(pool *sql.DB, script string) string {
	ctx, cancel := context.WithCancel(context.Background())
	e := &Execution{id: uuid.NewString(), started: time.Now(), cancel: cancel}

	m.mu.Lock()
	m.execs[e.id] = e
	m.mu.Unlock()

	go func() {
		defer cancel()
		e.run(ctx, pool, script)
	}()
	return e.id
}

func (m *Manager) get(id string) *Execution {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.execs[id]
}

// Snapshot returns the current state of an execution.
func (m *Manager) Snapshot(id string) (Snapshot, bool) {
	e := m.get(id)
	if e == nil {
		return Snapshot{}, false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	elapsed := e.elapsed
	if !e.done {
		elapsed = time.Since(e.started)
	}
	// copy set headers under the lock; rows already appended are immutable
	sets := make([]*ResultSet, len(e.sets))
	for i, s := range e.sets {
		sets[i] = &ResultSet{Columns: s.Columns, Rows: s.Rows[:len(s.Rows):len(s.Rows)], Truncated: s.Truncated}
	}
	msgs := make([]Message, len(e.msgs))
	copy(msgs, e.msgs)
	return Snapshot{
		Done:      e.done,
		Sets:      sets,
		Messages:  msgs,
		ElapsedMs: elapsed.Milliseconds(),
		Error:     e.errText,
	}, true
}

// Cancel aborts a running execution (sends an attention signal to the server).
func (m *Manager) Cancel(id string) bool {
	e := m.get(id)
	if e == nil {
		return false
	}
	e.cancel()
	return true
}

// Release drops a finished execution from memory.
func (m *Manager) Release(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.execs, id)
}

func (e *Execution) addMsg(kind, text string) {
	e.mu.Lock()
	e.msgs = append(e.msgs, Message{Kind: kind, Text: text})
	e.mu.Unlock()
}

func (e *Execution) run(ctx context.Context, pool *sql.DB, script string) {
	defer func() {
		e.mu.Lock()
		e.done = true
		e.elapsed = time.Since(e.started)
		e.mu.Unlock()
	}()

	// Dedicated session so temp tables/SET options survive across batches and
	// concurrent queries never share a busy connection.
	sess, err := pool.Conn(ctx)
	if err != nil {
		e.mu.Lock()
		e.errText = err.Error()
		e.mu.Unlock()
		return
	}
	defer sess.Close()

	for _, batch := range SplitBatches(script) {
		if ctx.Err() != nil {
			e.addMsg("error", "Query was cancelled by the user.")
			return
		}
		e.runBatch(ctx, sess, batch)
	}
}

func (e *Execution) runBatch(ctx context.Context, sess *sql.Conn, batch string) {
	retmsg := &sqlexp.ReturnMessage{}
	rows, err := sess.QueryContext(ctx, batch, retmsg)
	if err != nil {
		if ctx.Err() != nil {
			e.addMsg("error", "Query was cancelled by the user.")
		} else {
			e.addMsg("error", err.Error())
		}
		return
	}
	defer rows.Close()

	active := true
	for active {
		msg := retmsg.Message(ctx)
		switch m := msg.(type) {
		case sqlexp.MsgNotice:
			e.addMsg("info", m.Message.String())
		case sqlexp.MsgError:
			e.addMsg("error", m.Error.Error())
		case sqlexp.MsgRowsAffected:
			e.addMsg("rowcount", fmt.Sprintf("(%d row(s) affected)", m.Count))
		case sqlexp.MsgNext:
			e.readSet(rows)
		case sqlexp.MsgNextResultSet:
			active = rows.NextResultSet()
		}
		if ctx.Err() != nil {
			e.addMsg("error", "Query was cancelled by the user.")
			return
		}
	}
	if err := rows.Err(); err != nil && ctx.Err() == nil {
		e.addMsg("error", err.Error())
	}
}

func (e *Execution) readSet(rows *sql.Rows) {
	colNames, err := rows.Columns()
	if err != nil || len(colNames) == 0 {
		return
	}
	colTypes, _ := rows.ColumnTypes()
	set := &ResultSet{}
	for i, n := range colNames {
		typeName := ""
		if colTypes != nil && i < len(colTypes) {
			typeName = colTypes[i].DatabaseTypeName()
		}
		set.Columns = append(set.Columns, Column{Name: n, Type: typeName})
	}
	e.mu.Lock()
	e.sets = append(e.sets, set)
	e.mu.Unlock()

	vals := make([]any, len(colNames))
	ptrs := make([]any, len(colNames))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	count := 0
	for rows.Next() {
		if count >= maxRowsPerSet {
			// keep draining so the protocol reaches the next result set,
			// but stop keeping rows
			e.mu.Lock()
			set.Truncated = true
			e.mu.Unlock()
			continue
		}
		if err := rows.Scan(ptrs...); err != nil {
			e.addMsg("error", err.Error())
			return
		}
		row := make([]any, len(vals))
		for i, v := range vals {
			row[i] = jsonValue(v, set.Columns[i].Type)
		}
		e.mu.Lock()
		set.Rows = append(set.Rows, row)
		e.mu.Unlock()
		count++
	}
}

// jsonValue converts driver values into JSON-friendly representations.
func jsonValue(v any, sqlType string) any {
	switch t := v.(type) {
	case nil:
		return nil
	case time.Time:
		return t.Format("2006-01-02 15:04:05.9999999")
	case []byte:
		switch sqlType {
		case "DECIMAL", "NUMERIC", "MONEY", "SMALLMONEY", "BIGINT":
			return string(t)
		case "UNIQUEIDENTIFIER":
			if len(t) == 16 {
				return fmt.Sprintf("%08X-%04X-%04X-%04X-%012X",
					uint32(t[3])|uint32(t[2])<<8|uint32(t[1])<<16|uint32(t[0])<<24,
					uint16(t[5])|uint16(t[4])<<8,
					uint16(t[7])|uint16(t[6])<<8,
					t[8:10], t[10:16])
			}
			return "0x" + hex.EncodeToString(t)
		default:
			if utf8.Valid(t) && sqlType != "VARBINARY" && sqlType != "BINARY" && sqlType != "IMAGE" && sqlType != "TIMESTAMP" && sqlType != "ROWVERSION" {
				return string(t)
			}
			const maxPreview = 256
			if len(t) > maxPreview {
				return "0x" + hex.EncodeToString(t[:maxPreview]) + "…"
			}
			return "0x" + hex.EncodeToString(t)
		}
	default:
		return v
	}
}
