import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openDatabase, scan, startServer } from './dir-compare.mjs';

test('migrates a legacy database transactionally and creates a backup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  try {
    const databaseFile = path.join(root, 'legacy.sqlite3');
    let database = new DatabaseSync(databaseFile);
    database.exec(`
      CREATE TABLE files (
        source_path TEXT PRIMARY KEY,
        relative_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        size INTEGER NOT NULL,
        match_status TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      INSERT INTO files VALUES (
        '/source/kept.jpg', 'kept.jpg', 'kept.jpg', 42,
        'missing', 'transfer', 1, '2026-01-01T00:00:00Z'
      );
    `);
    database.close();

    database = openDatabase(databaseFile);
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(
      database.prepare("SELECT decision FROM files WHERE source_path = '/source/kept.jpg'").get().decision,
      'transfer',
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'candidates'").get().count,
      1,
    );
    database.close();

    const backups = (await readdir(root)).filter(name => name.startsWith('legacy.sqlite3.backup-v0-'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(root, backups[0]), { readOnly: true });
    assert.equal(
      backup.prepare("SELECT decision FROM files WHERE source_path = '/source/kept.jpg'").get().decision,
      'transfer',
    );
    backup.close();
  } finally { await rm(root, { recursive: true }); }
});

test('refuses a database created by a newer app version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  try {
    const databaseFile = path.join(root, 'future.sqlite3');
    const database = new DatabaseSync(databaseFile);
    database.exec('PRAGMA user_version = 999');
    database.close();
    assert.throws(() => openDatabase(databaseFile), /newer than this app supports/);
  } finally { await rm(root, { recursive: true }); }
});

test('classifies missing, different-size, and matching files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await mkdir(source);
    await mkdir(path.join(target, 'nested'), { recursive: true });
    await writeFile(path.join(source, 'same.jpg'), 'same');
    await writeFile(path.join(source, 'missing.jpg'), 'missing');
    await writeFile(path.join(source, 'wrong.jpg'), 'longer');
    await writeFile(path.join(source, 'one-of-many.jpg'), 'yes');
    await writeFile(path.join(target, 'nested', 'same.jpg'), 'same');
    await writeFile(path.join(target, 'wrong.jpg'), 'no');
    await writeFile(path.join(target, 'one-of-many.jpg'), 'no');
    await writeFile(path.join(target, 'nested', 'one-of-many.jpg'), 'yes');
    const databaseFile = path.join(root, 'results.sqlite3');
    const counts = await scan(source, target, databaseFile);
    assert.deepEqual(counts, { matched: 2, missing: 1, size_mismatch: 1, source_files: 4, target_files: 4 });
    const database = new DatabaseSync(databaseFile);
    const find = database.prepare('SELECT match_status FROM files WHERE source_path = ?');
    assert.equal(find.get(path.join(source, 'missing.jpg')).match_status, 'missing');
    assert.equal(find.get(path.join(source, 'wrong.jpg')).match_status, 'size_mismatch');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM candidates').get().count, 4);
    database.close();
  } finally { await rm(root, { recursive: true }); }
});

test('scanner accepts an injected non-SQLite repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await mkdir(source); await mkdir(target);
    await writeFile(path.join(source, 'photo.jpg'), 'source-photo');
    await writeFile(path.join(target, 'photo.jpg'), 'target');

    const saved = [];
    const repository = {
      began: false,
      completed: null,
      async beginScan() { this.began = true; },
      async saveFile(file, candidates) { saved.push({ file, candidates }); },
      async completeScan(metadata) { this.completed = metadata; },
      async rollbackScan() { throw new Error('rollback should not be called'); },
    };
    const counts = await scan(source, target, undefined, { repository });
    assert.equal(repository.began, true);
    assert.equal(repository.completed.sourceRoot, source);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].file.matchStatus, 'size_mismatch');
    assert.equal(saved[0].candidates[0].path, path.join(target, 'photo.jpg'));
    assert.equal(counts.size_mismatch, 1);
  } finally { await rm(root, { recursive: true }); }
});

test('server accepts an injected non-SQLite repository', async () => {
  let server;
  const updates = [];
  const repository = {
    async findItems() {
      return {
        items: [{
          sourcePath: '/source/photo.jpg',
          relativePath: 'photo.jpg',
          filename: 'photo.jpg',
          size: 2048,
          matchStatus: 'missing',
          decision: 'pending',
          candidates: [],
        }],
        stats: { pending: 1, ignore: 0, transfer: 0 },
      };
    },
    async updateDecision(sourcePath, decision) {
      updates.push({ sourcePath, decision });
      return true;
    },
  };
  try {
    server = startServer(undefined, { port: 0, repository });
    await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    const items = await fetch(`http://127.0.0.1:${port}/api/items`).then(response => response.json());
    assert.equal(items.items[0].humanSize, '2.0 KB');
    const response = await fetch(`http://127.0.0.1:${port}/api/items`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: '/source/photo.jpg', decision: 'ignore' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{ sourcePath: '/source/photo.jpg', decision: 'ignore' }]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('API updates a decision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  let server;
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await mkdir(source); await mkdir(target);
    const photo = path.join(source, 'photo.jpg');
    const targetPhoto = path.join(target, 'photo.jpg');
    await writeFile(photo, 'photo');
    await writeFile(targetPhoto, 'target-photo');
    const databaseFile = path.join(root, 'results.sqlite3');
    await scan(source, target, databaseFile);
    server = startServer(databaseFile, { port: 0 });
    await new Promise(resolve => server.once('listening', resolve));
    const port = server.address().port;
    const itemsResponse = await fetch(`http://127.0.0.1:${port}/api/items`);
    const items = await itemsResponse.json();
    assert.equal(items.items[0].matchStatus, 'size_mismatch');
    assert.deepEqual(items.items[0].candidates.map(candidate => candidate.path), [targetPhoto]);
    const response = await fetch(`http://127.0.0.1:${port}/api/items`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath: photo, decision: 'transfer' }),
    });
    assert.equal(response.status, 200);
    const mediaUrl = `http://127.0.0.1:${port}/media?path=${encodeURIComponent(photo)}`;
    const media = await fetch(mediaUrl);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('accept-ranges'), 'bytes');
    assert.equal(await media.text(), 'photo');
    const partial = await fetch(mediaUrl, { headers: { range: 'bytes=1-3' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 1-3/5');
    assert.equal(await partial.text(), 'hot');
    const head = await fetch(mediaUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '5');
    const database = new DatabaseSync(databaseFile);
    assert.equal(database.prepare('SELECT decision FROM files WHERE source_path = ?').get(photo).decision, 'transfer');
    database.close();
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true });
  }
});

test('review decisions survive a rescan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dir-compare-'));
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await mkdir(source); await mkdir(target);
    const photo = path.join(source, 'photo.jpg');
    await writeFile(photo, 'photo');
    const databaseFile = path.join(root, 'results.sqlite3');
    await scan(source, target, databaseFile);
    let database = new DatabaseSync(databaseFile);
    database.prepare('UPDATE files SET decision = ? WHERE source_path = ?').run('ignore', photo);
    database.close();

    await scan(source, target, databaseFile);
    database = new DatabaseSync(databaseFile);
    assert.equal(database.prepare('SELECT decision FROM files WHERE source_path = ?').get(photo).decision, 'ignore');
    database.close();
  } finally { await rm(root, { recursive: true }); }
});
