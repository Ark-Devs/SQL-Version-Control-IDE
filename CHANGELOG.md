# Changelog

All notable changes to ArkSQL.

## [0.2.1] — 2026-07-18

### ArkSQL
- The IDE is now **ArkSQL** ("Version-Controlled SQL") with a new app icon,
  installer branding, and a deep-space neon design overhaul: cyan accents for
  data/queries, violet for version control, glowing status indicators, and a
  new Monaco syntax theme.
- Full SSMS-style application menu (File / Edit / View / Git / Query / Tools /
  Window / Help) with keyboard accelerators and context-aware enabling.

### Version control
- **`SQL/` repo layout**: objects now live under `SQL/<database>/<schema>/…`;
  legacy `DB/` repos migrate automatically on open (left uncommitted for
  review). A repo without a `SQL/` folder triggers a first-sync prompt with a
  baseline-commit flow.
- **VS Code-style status in the Object Explorer**: modified objects amber (M),
  new objects green (A), dropped objects as red strikethrough ghost rows (D),
  with change-count badges on databases and folders.
- **Live mirror**: successful `CREATE`/`ALTER`/`DROP` against a tracked
  database instantly re-scripts the object into the repo (toggle in Settings),
  so git status always reflects the database.
- **Schema Compare** (Tools menu or Git panel): compare any ref against a
  target connection (e.g. production), see what's missing/different/extra per
  object with side-by-side diffs, and deploy the selected objects through the
  transactional deploy pipeline.

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
