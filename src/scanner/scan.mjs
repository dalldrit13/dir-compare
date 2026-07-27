import { stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_DATABASE } from '../constants.mjs';
import { SqliteScanRepository } from '../database/repositories/sqlite-scan-repository.mjs';
import { walk } from './walk.mjs';

export async function scan(
  sourceArgument,
  targetArgument,
  databaseFile = DEFAULT_DATABASE,
  { repository: injectedRepository } = {},
) {
  const source = path.resolve(sourceArgument);
  const target = path.resolve(targetArgument);
  if (!(await stat(source).catch(() => null))?.isDirectory()) {
    throw new Error(`source is not a directory: ${source}`);
  }
  if (!(await stat(target).catch(() => null))?.isDirectory()) {
    throw new Error(`target is not a directory: ${target}`);
  }

  const targetIndex = new Map();
  let targetFiles = 0;
  for await (const file of walk(target)) {
    if (!targetIndex.has(file.name)) targetIndex.set(file.name, []);
    targetIndex.get(file.name).push({ path: file.path, size: file.size });
    targetFiles += 1;
  }

  const ownsRepository = !injectedRepository;
  const repository = injectedRepository ?? new SqliteScanRepository(databaseFile);
  const counts = {
    matched: 0,
    missing: 0,
    size_mismatch: 0,
    source_files: 0,
    target_files: targetFiles,
  };
  const scannedAt = new Date().toISOString();

  try {
    await repository.beginScan();
    for await (const file of walk(source)) {
      if (await repository.shouldExcludeSourcePath?.(file.path)) continue;
      const candidates = targetIndex.get(file.name) ?? [];
      const matchStatus = candidates.length === 0
        ? 'missing'
        : candidates.some(candidate => candidate.size === file.size) ? 'matched' : 'size_mismatch';
      await repository.saveFile({
        sourcePath: file.path,
        relativePath: path.relative(source, file.path),
        filename: file.name,
        size: file.size,
        matchStatus,
        updatedAt: scannedAt,
      }, candidates);
      counts[matchStatus] += 1;
      counts.source_files += 1;
    }
    await repository.completeScan({ sourceRoot: source, targetRoot: target, scannedAt });
  } catch (error) {
    await repository.rollbackScan();
    throw error;
  } finally {
    if (ownsRepository) await repository.close();
  }

  return counts;
}
