export const migrations = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE IF NOT EXISTS files (
        source_path TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        match_status TEXT NOT NULL
          CHECK (match_status IN ('matched', 'missing', 'size_mismatch')),
        decision TEXT NOT NULL DEFAULT 'pending'
          CHECK (decision IN ('pending', 'ignore', 'transfer')),
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS files_review_idx
        ON files(active, match_status, decision, relative_path);

      CREATE TABLE IF NOT EXISTS candidates (
        source_path TEXT NOT NULL
          REFERENCES files(source_path) ON DELETE CASCADE,
        target_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        PRIMARY KEY (source_path, target_path)
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_DATABASE_VERSION = migrations.at(-1)?.version ?? 0;
