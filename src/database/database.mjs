import { statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { LATEST_DATABASE_VERSION, migrations } from './migrations.mjs';

function databaseVersion(database) {
  return database.prepare('PRAGMA user_version').get().user_version;
}

function hasUserTables(database) {
  return database.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).get().count > 0;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupPath(filename, version) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  return `${filename}.backup-v${version}-${timestamp}`;
}

function backupBeforeMigration(database, filename, version) {
  if (!hasUserTables(database)) return null;
  const destination = backupPath(filename, version);
  database.exec(`VACUUM INTO ${sqlString(destination)}`);
  return destination;
}

export function migrateDatabase(database, filename) {
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(`Invalid migration sequence: expected version ${expected}, got ${migration.version}`);
    }
  });
  const currentVersion = databaseVersion(database);
  if (currentVersion > LATEST_DATABASE_VERSION) {
    throw new Error(
      `Database version ${currentVersion} is newer than this app supports ` +
      `(latest: ${LATEST_DATABASE_VERSION}). Upgrade the app before opening it.`,
    );
  }

  const pending = migrations.filter(migration => migration.version > currentVersion);
  if (!pending.length) return { from: currentVersion, to: currentVersion, backup: null };

  const backup = backupBeforeMigration(database, filename, currentVersion);
  database.exec('BEGIN EXCLUSIVE');
  try {
    for (const migration of pending) {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
    }

    const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) {
      throw new Error(`Migration failed foreign-key validation: ${JSON.stringify(foreignKeyErrors)}`);
    }
    const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`Migration failed integrity check: ${integrity}`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  if (backup) console.log(`Database backup created: ${backup}`);
  return { from: currentVersion, to: LATEST_DATABASE_VERSION, backup };
}

export function openDatabase(filename) {
  const resolved = path.resolve(filename);
  // Give a clearer error if an existing path is not a regular file.
  try {
    if (!statSync(resolved).isFile()) throw new Error(`Database path is not a file: ${resolved}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const database = new DatabaseSync(resolved);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);
    migrateDatabase(database, resolved);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
