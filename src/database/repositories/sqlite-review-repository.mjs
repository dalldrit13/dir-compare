import { DECISIONS } from '../../constants.mjs';
import { ReviewRepository } from '../../repositories/review-repository.mjs';
import { openDatabase } from '../database.mjs';

export class SqliteReviewRepository extends ReviewRepository {
  #database;

  constructor(databaseFile) {
    super();
    this.#database = openDatabase(databaseFile);
  }

  findItems({ decision, status }) {
    const stats = { pending: 0, ignore: 0, transfer: 0 };
    for (const row of this.#database.prepare(`
      SELECT decision, COUNT(*) AS count FROM files
      WHERE active = 1 AND match_status != 'matched' GROUP BY decision
    `).all()) stats[row.decision] = row.count;

    const where = ["f.active = 1", "f.match_status != 'matched'"];
    const parameters = [];
    if (DECISIONS.has(decision)) {
      where.push('f.decision = ?');
      parameters.push(decision);
    }
    if (status === 'missing' || status === 'size_mismatch') {
      where.push('f.match_status = ?');
      parameters.push(status);
    }

    const rows = this.#database.prepare(`
      SELECT f.source_path, f.relative_path, f.filename, f.size, f.match_status,
             f.decision, c.target_path, c.size AS candidate_size
      FROM files f LEFT JOIN candidates c ON c.source_path = f.source_path
      WHERE ${where.join(' AND ')}
      ORDER BY f.relative_path, c.target_path
    `).all(...parameters);

    const byPath = new Map();
    for (const row of rows) {
      if (!byPath.has(row.source_path)) {
        byPath.set(row.source_path, {
          sourcePath: row.source_path,
          relativePath: row.relative_path,
          filename: row.filename,
          size: row.size,
          matchStatus: row.match_status,
          decision: row.decision,
          candidates: [],
        });
      }
      if (row.target_path !== null) {
        byPath.get(row.source_path).candidates.push({
          path: row.target_path,
          size: row.candidate_size,
        });
      }
    }

    return { items: [...byPath.values()], stats };
  }

  updateDecision(sourcePath, decision) {
    return this.#database.prepare(
      'UPDATE files SET decision = ? WHERE source_path = ?',
    ).run(decision, sourcePath).changes > 0;
  }

  close() {
    this.#database.close();
  }
}
