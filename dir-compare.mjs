#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from './src/cli.mjs';

export { openDatabase } from './src/database/database.mjs';
export { SqliteReviewRepository } from './src/database/repositories/sqlite-review-repository.mjs';
export { SqliteScanRepository } from './src/database/repositories/sqlite-scan-repository.mjs';
export { ReviewRepository } from './src/repositories/review-repository.mjs';
export { ScanRepository } from './src/repositories/scan-repository.mjs';
export { scan } from './src/scanner/scan.mjs';
export { startServer } from './src/server/server.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {
    if (code !== null) process.exitCode = code;
  }).catch(error => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
