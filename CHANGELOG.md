# Changelog

All notable changes to SQL Version Control IDE.

## [0.2.0] — 2026-07-07

### Design overhaul
- Complete visual redesign: design-token system, Lucide icon set replacing
  emoji, consistent buttons/inputs/modals/menus, refined dark palette,
  focus rings, motion, professional tree and grid styling.

### Added
- **Global search** (`Ctrl+Shift+F`): search object names and T-SQL
  definitions across every database on a connection; right-click a database
  or folder in the explorer to search that scope.
- **Update notifications**: the app checks GitHub Releases and shows a
  banner when a newer version is available.
- MIT license, changelog, and release documentation.

## [0.1.2] — 2026-07-07

### Added
- **Export to Code**: script procs/views/functions/triggers into an
  application project's `sql/` folder (`sql/sp`, `sql/views`,
  `sql/scalar functions`, `sql/table valued functions`, `sql/triggers`) —
  incremental, never deletes, reports added/updated/unchanged.
- **Table Design view**: read-only designer (columns, keys, indexes, check
  constraints) with the generated CREATE TABLE script.
- **Editor tab colors**: red = last run had errors, yellow = modified,
  green = new object from template.
- **GitHub sign-in**: token validated against the GitHub API, stored in
  Windows Credential Manager; github.com push/pull uses it automatically.

## [0.1.1] — 2026-07-07

### Added
- SSMS-depth Object Explorer: per-table Columns/Keys/Constraints/Triggers/
  Indexes; Programmability (procs with parameters, functions, database
  triggers, user-defined types, sequences); Synonyms; Security (users,
  roles, schemas).

## [0.1.0] — 2026-07-06

Initial release.

- Object Explorer, Monaco SQL editor (F5 runs selection-or-buffer),
  multi-resultset grid, messages, true cancellation.
- Git versioning of database objects: multi-database system repos
  (`DB/<Database>/…` on branch `main`), sync/commit/branch/merge/history/
  diff, drift badges (green new / yellow modified).
- Deploy any branch to any server (`CREATE OR ALTER`, one transaction per
  database), schema-aware autocomplete, GitHub/Azure DevOps remotes.
- SSMS-style object headers (Author/Create date/Description + update log).
- Connection profiles with Windows Credential Manager storage; TCP, Named
  Pipes and Shared Memory protocols.
