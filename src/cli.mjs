import { stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_DATABASE } from './constants.mjs';
import { scan } from './scanner/scan.mjs';
import { startServer } from './server/server.mjs';

function usage() {
  console.log(`Usage:
  node dir-compare.mjs scan <source> <target> [--db results.sqlite3]
  node dir-compare.mjs serve [--db results.sqlite3] [--host 127.0.0.1] [--port 8787]`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'scan') {
    const positional = rest.filter(
      (value, index) => !value.startsWith('--') && !rest[index - 1]?.startsWith('--'),
    );
    if (positional.length < 2) {
      usage();
      return 2;
    }
    const databaseFile = option(rest, '--db', DEFAULT_DATABASE);
    const counts = await scan(positional[0], positional[1], databaseFile);
    console.log(JSON.stringify(counts, null, 2));
    console.log(`Results saved to ${path.resolve(databaseFile)}`);
    return 0;
  }

  if (command === 'serve') {
    const databaseFile = option(rest, '--db', DEFAULT_DATABASE);
    const info = await stat(databaseFile).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`database does not exist; run scan first: ${path.resolve(databaseFile)}`);
    }
    startServer(databaseFile, {
      host: option(rest, '--host', '127.0.0.1'),
      port: Number(option(rest, '--port', 8787)),
    });
    return null;
  }

  usage();
  return command ? 2 : 0;
}
