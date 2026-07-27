import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { ScanRepository } from '../../repositories/scan-repository.mjs';
import { openDatabase } from '../database.mjs';

export class SqliteScanRepository extends ScanRepository {
  #database;
  #databasePath;
  #inTransaction = false;
  #upsertFile;
  #deleteCandidates;
  #insertCandidate;
  #setMetadata;

  constructor(databaseFile) {
    super();
    this.#databasePath = path.resolve(databaseFile);
    mkdirSync(path.dirname(this.#databasePath), { recursive: true });
    this.#database = openDatabase(this.#databasePath);
    this.#upsertFile = this.#database.prepare(`
      INSERT INTO files
        (source_path, relative_path, filename, size, match_status, active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(source_path) DO UPDATE SET
        relative_path = excluded.relative_path,
        filename = excluded.filename,
        size = excluded.size,
        match_status = excluded.match_status,
        active = 1,
        updated_at = excluded.updated_at
    `);
    this.#deleteCandidates = this.#database.prepare(
      'DELETE FROM candidates WHERE source_path = ?',
    );
    this.#insertCandidate = this.#database.prepare(
      'INSERT INTO candidates(source_path, target_path, size) VALUES (?, ?, ?)',
    );
    this.#setMetadata = this.#database.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
  }

  shouldExcludeSourcePath(filePath) {
    const resolved = path.resolve(filePath);
    return resolved === this.#databasePath || resolved.startsWith(`${this.#databasePath}-`);
  }

  beginScan() {
    if (this.#inTransaction) throw new Error('A scan transaction is already active');
    this.#database.exec('BEGIN IMMEDIATE');
    this.#inTransaction = true;
    this.#database.exec('UPDATE files SET active = 0');
  }

  saveFile(file, candidates) {
    if (!this.#inTransaction) throw new Error('No scan transaction is active');
    this.#upsertFile.run(
      file.sourcePath,
      file.relativePath,
      file.filename,
      file.size,
      file.matchStatus,
      file.updatedAt,
    );
    this.#deleteCandidates.run(file.sourcePath);
    for (const candidate of candidates) {
      this.#insertCandidate.run(file.sourcePath, candidate.path, candidate.size);
    }
  }

  completeScan({ sourceRoot, targetRoot, scannedAt }) {
    if (!this.#inTransaction) throw new Error('No scan transaction is active');
    this.#database.exec('DELETE FROM files WHERE active = 0');
    this.#setMetadata.run('source_root', sourceRoot);
    this.#setMetadata.run('target_root', targetRoot);
    this.#setMetadata.run('last_scan', scannedAt);
    this.#database.exec('COMMIT');
    this.#inTransaction = false;
  }

  rollbackScan() {
    if (!this.#inTransaction) return;
    this.#database.exec('ROLLBACK');
    this.#inTransaction = false;
  }

  close() {
    this.rollbackScan();
    this.#database.close();
  }
}
