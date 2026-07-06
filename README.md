# SQL Version Control IDE

A desktop IDE for Microsoft SQL Server with **built-in Git version control for database objects** — keep different versions of the same stored procedure on branches (e.g. a `test` branch and a `deploy` branch) and deploy any branch to any server.

Built with Electron + React + Monaco (the VS Code editor) and a Go backend that owns all SQL Server and Git operations.

## Features

- **Object Explorer** — servers → databases → tables (columns, indexes), views, stored procedures, table-valued & scalar functions. Double-click a proc to open its source; double-click a table for `SELECT TOP 1000`.
- **SQL editor** — Monaco with T-SQL highlighting, SSMS-style dark theme, and schema-aware autocomplete (tables, columns via alias resolution, `EXEC` proc snippets with parameters). **F5** or **Ctrl+E** runs the selection if there is one, otherwise the whole buffer — per-tab connection and database.
- **Query results** — multiple result sets, virtualized grid (10k rows/set cap), Messages pane with `PRINT`/`RAISERROR`/rowcounts, execution time, and true server-side cancellation.
- **Git versioning** — one repo per database. *Sync from Database* scripts every object to deterministic `.sql` files (`dbo/StoredProcedures/usp_Foo.sql`…); git status is your drift report. Commit selected objects, create/switch branches, view per-object history, side-by-side Monaco diffs (working vs HEAD, or any commit), file-level merges with a conflict resolver.
- **Deploy** — pick a branch, pick a target connection + database, review every script, then execute `CREATE OR ALTER` in a single transaction (all-or-nothing, one dependency-retry pass). Tables are tracked for history but never deployed.
- **Remotes** — push/pull to GitHub or Azure DevOps over HTTPS with a Personal Access Token (stored in Windows Credential Manager).
- **Security** — connection passwords and PATs live in Windows Credential Manager, never in files. The backend binds to `127.0.0.1` with a per-session bearer token.

## Development

Prereqs: Node 20+ (LTS recommended), Go 1.22+, a SQL Server to talk to.

```powershell
npm install
npm run dev          # builds the Go backend, starts Electron with hot reload
```

Backend tests:

```powershell
npm run test:backend # go test ./...
```

## Packaging

```powershell
npm run dist         # go build → electron-builder → release/*.exe (NSIS installer)
```

The Go backend compiles to a single `svcide-backend.exe` bundled under `resources/backend/`.

## Architecture

```
┌────────────────────── Electron ──────────────────────┐
│  renderer (React + Monaco)                           │
│      │  fetch + bearer token                         │
│  main (spawns backend, handshake on stdout)          │
└──────┼───────────────────────────────────────────────┘
       ▼
  svcide-backend.exe  (Go, 127.0.0.1:<random port>)
   ├─ conn      profiles (%APPDATA%\SqlVcIde), keyring, pool registry
   ├─ db        metadata, GO-split executor, DDL scripter, autocomplete
   ├─ gitrepo   go-git: sync/commit/branch/merge/log/remotes + manifest
   ├─ deploy    planner (order: functions→views→procs→triggers) + runner
   └─ httpapi   REST endpoints
```

Notes:
- Connection protocols: TCP (default), Named Pipes, or Shared Memory (`lpc` — pick this for a local server without TCP enabled).
- Scripted files are normalized (LF, single trailing newline, `CREATE OR ALTER` header) so re-syncs never produce phantom diffs.
- Encrypted modules (`WITH ENCRYPTION`) cannot be scripted and are skipped with a warning.
