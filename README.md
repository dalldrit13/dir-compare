# Dir Compare

A dependency-free Node tool that checks whether every file in a source directory
has a file with the same **name and exact byte size** anywhere in a target
directory. Problems are saved to a local SQLite database and can be reviewed in
a small web UI.

## Requirements

Node 22.5 or newer, which includes the built-in `node:sqlite` module. There is
nothing to install and no database process.

## Use

Run it directly from npm:

```bash
npx @gansa/dir-compare scan "/path/to/source" "/path/to/target"
npx @gansa/dir-compare serve
```

Or install it globally and use the `dir-compare` command:

```bash
npm install --global @gansa/dir-compare
dir-compare scan "/path/to/source" "/path/to/target"
dir-compare serve
```

From a source checkout, use:

```bash
node dir-compare.mjs scan "/path/to/source" "/path/to/target"
node dir-compare.mjs serve
```

Then open <http://127.0.0.1:8787>. The UI previews common image/video formats and
lets you mark files **Ignore**, **Needs transfer**, or **Pending**. Review state is
stored in `dir-compare.sqlite3` and survives rescans.

Custom database and port:

```bash
node dir-compare.mjs scan source target --db /tmp/photos.sqlite3
node dir-compare.mjs serve --db /tmp/photos.sqlite3 --port 9000
```

## Publishing

Publishing uses npm's staged-publishing flow. A published GitHub release runs
`.github/workflows/stage-package.yml`, tests the package, and submits it to npm
for review; it does not make the version publicly available. Stable releases
are staged with the `latest` tag and GitHub prereleases with the `next` tag.

Before using the workflow:

- The package must already exist on npm; npm does not support staging a package's
  first release.
- Configure `stage-package.yml` from `dalldrit13/dir-compare` as the trusted
  publisher for `@gansa/dir-compare` in the package's npm settings, allowing
  `npm stage publish` only.
- Enable 2FA on the npm maintainer account. The release tag must be
  `v<package.json version>`, such as `v0.2.0`.

After the workflow succeeds, review and approve the staged version on npmjs.com.
It can also be reviewed and approved with npm 11.15 or newer and Node 22.14 or
newer:

```bash
npm stage list @gansa/dir-compare
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Approval requires 2FA and is the step that publishes the version. Reject an
incorrect staged version with `npm stage reject <stage-id>`.

## Matching rules

- Directory structure is ignored; filenames are searched anywhere under target.
- Names must match exactly (including case on case-sensitive filesystems).
- If several target files have the same name, any exact size match is a success.
- Files that disappear or cannot be read during scanning are skipped with a warning.
- The source and target files are never modified.

## Project structure

```text
dir-compare.mjs            CLI entry point
src/
  cli.mjs                  Command parsing
  database/
    database.mjs           Connection setup and migration runner
    migrations.mjs         Ordered, versioned schema migrations
    repositories/
      sqlite-scan-repository.mjs
      sqlite-review-repository.mjs
  scanner/
    scan.mjs               Comparison and persistence
    walk.mjs               Directory traversal
  repositories/
    scan-repository.mjs    Scan persistence contract
    review-repository.mjs  Review persistence contract
  server/
    server.mjs             Review API and local HTTP server
    media.mjs              Image/video streaming and byte ranges
  ui/
    index.html             Review interface
```

## Database migrations

The database uses SQLite's `PRAGMA user_version`. Migrations are ordered and run
inside one exclusive transaction. Before changing an existing database, the app
creates a consistent timestamped backup beside it, such as:

```text
dir-compare.sqlite3.backup-v0-2026-07-24T12-34-56-000Z
```

Each migration updates `user_version`, then foreign-key and integrity checks must
pass before the transaction commits. A database with a version newer than the app
supports is rejected instead of being modified. Add future migrations to
`src/database/migrations.mjs` with the next consecutive version number.

## Persistence repositories

The scanner and HTTP server do not issue SQL or import SQLite. SQLite is the
default adapter behind two repository classes:

- `SqliteScanRepository` owns transactional scan writes through
  `beginScan`, `saveFile`, `completeScan`, and `rollbackScan`.
- `SqliteReviewRepository` owns review reads and decisions through
  `findItems` and `updateDecision`.

Both `scan` and `startServer` accept a `repository` option. An alternate storage
provider can implement the same methods and be injected without changing the
comparison, API, media, or UI code. Injected repositories remain caller-owned;
the application only closes repositories that it creates itself.
