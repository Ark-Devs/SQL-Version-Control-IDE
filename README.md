<div align="center">

# ArkSQL

**Version-Controlled SQL** — a desktop IDE for Microsoft SQL Server with Git built into its bones.

Version stored procedures on branches. Diff them. Merge them. Deploy any branch to any server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Made with Go](https://img.shields.io/badge/backend-Go-00ADD8)
![Electron](https://img.shields.io/badge/shell-Electron%20%2B%20React-47848F)

</div>

---

## Why

Database code — stored procedures, functions, views — is real code, but it usually lives outside version control, edited live on servers with no history, no review, and no way to keep a *test* version and a *production* version of the same proc. This IDE fixes that:

- Every object is scripted to a `.sql` file in a **real Git repository** the app manages for you.
- Branches are **free-form**: keep `test` and `deploy` versions of the same SP side by side.
- **Deploying** = pick a branch, pick a server, review every script, run `CREATE OR ALTER` in a transaction.
- One repo can track a whole **system across databases** (`Hospital`, `Pharmacy`, …) — matching apps whose procs use cross-database references.

## Features

| | |
|---|---|
| 🌲 **Deep Object Explorer** | SSMS-style tree: tables (columns/keys/constraints/triggers/indexes), views, synonyms, programmability (procs with parameters, functions, types, sequences, DB triggers), security (users/roles/schemas). Filter box + drift badges. |
| ✍️ **Monaco SQL editor** | The VS Code editor with T-SQL highlighting, schema-aware autocomplete (tables after `FROM`, columns from aliases, `EXEC` snippets), F5 runs selection-or-buffer, per-tab connection + database. |
| 📊 **Results** | Multiple result sets, virtualized grid, `PRINT`/error messages, execution time, true server-side cancellation. |
| 🌿 **Git versioning** | Sync database → repo (idempotent, phantom-diff-free), commit selected objects, branches on `main` baseline, per-object history, side-by-side diffs, file-level merge with conflict resolver, GitHub/Azure DevOps push/pull. |
| 🚦 **Drift badges** | Green = new object not in the baseline; yellow = modified — even when the object was never synced (via `modify_date` heuristics). |
| 🚀 **Deploy** | Any branch → any saved connection. Objects ordered by dependency kind, previewed, executed `CREATE OR ALTER` in one transaction per database, all-or-nothing with rollback. |
| 📦 **Export to Code** | Script procs/functions/views into your application repo's `sql/` folder (`sql/sp`, `sql/table valued functions`, …) — incremental, never deletes, GitHub-style A/M report. |
| 📝 **Object headers** | SSMS-style `Author / Create date / Description` blocks filled automatically; every `CREATE OR ALTER` execution prompts for an update note appended to the header. |
| 🎨 **Design view** | Read-only table designer: columns, keys, indexes, constraints + generated `CREATE TABLE`. |
| 🔎 **Global search** | `Ctrl+Shift+F` searches object names *and definitions* across databases. |
| 🔐 **Security** | Passwords + tokens in Windows Credential Manager, never on disk. Local-only backend with per-session bearer token. |

## Install

Grab the latest installer from **[Releases](../../releases)** and run it. Unsigned for now — SmartScreen will ask once ("More info" → "Run anyway").

The app checks Releases and shows a banner when a newer version is available.

## Quick start

1. **＋** in Object Explorer → server, auth, and (for a local instance without TCP) *Shared Memory* protocol → Test → Save.
2. Browse. Double-click a proc for its source, F5 to run queries.
3. **Git tab** → *New repo from database(s)* → pick the databases of one system → Create. That's your `main` baseline.
4. Branch from the status bar, edit, commit, **Deploy…** to any server. **⇩ Export to Code…** drops `sql/` files into your app project.

## Development

Prereqs: Node 20+, Go 1.22+, a SQL Server.

```powershell
npm install
npm run dev        # builds the Go backend + launches Electron with HMR
npm run typecheck  # renderer + main TS
npm run test:backend
npm run dist       # NSIS installer → release/
```

## Architecture

```
Electron main ──spawns──▶ svcide-backend.exe (Go, 127.0.0.1:<random>, bearer token)
     │                        ├─ conn/     profiles, credential manager, pool registry
renderer (React+Monaco)       ├─ db/       metadata, executor (GO-split/cancel), scripter, search
     │      HTTP+token        ├─ gitrepo/  go-git sync/commit/branch/merge/remotes + manifest
     └────────────────────▶   ├─ deploy/   planner + transactional runner
                              └─ httpapi/  REST
```

Design decisions worth knowing: object scripts are normalized (LF, single trailing newline, `CREATE OR ALTER` headers) so re-syncs never produce phantom diffs; merges are file-level with explicit conflict resolution; tables are versioned for history but never auto-deployed.

## Roadmap

- Editable table designer (ALTER TABLE generation)
- Built-in AI assistant (bring-your-own Claude API key)
- Execution plans, grid export (CSV/Excel), result editing
- PostgreSQL / MySQL drivers
- Extension API

## License

[MIT](LICENSE) © 2026 21c Care
