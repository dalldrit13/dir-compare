import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export async function* walk(root) {
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      console.warn(`warning: cannot read ${directory}: ${error.message}`);
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          const info = await stat(fullPath);
          if (info.isFile()) yield { path: fullPath, name: entry.name, size: info.size };
        } catch (error) {
          console.warn(`warning: cannot inspect ${fullPath}: ${error.message}`);
        }
      }
    }
  }
}
