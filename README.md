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

Then open <http://127.0.0.1:8787>. The UI previews common image/video formats and
lets you mark files **Ignore**, **Needs transfer**, or **Pending**. Review state is
stored in `dir-compare.sqlite3` and survives rescans.

Custom database and port:

```bash
node dir-compare.mjs scan source target --db /tmp/photos.sqlite3
node dir-compare.mjs serve --db /tmp/photos.sqlite3 --port 9000
```

## Matching rules

- Directory structure is ignored; filenames are searched anywhere under target.
- Names must match exactly (including case on case-sensitive filesystems).
- If several target files have the same name, any exact size match is a success.
- Files that disappear or cannot be read during scanning are skipped with a warning.
- The source and target files are never modified.


