import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { DECISIONS, DEFAULT_DATABASE } from '../constants.mjs';
import { SqliteReviewRepository } from '../database/repositories/sqlite-review-repository.mjs';
import { serveMedia } from './media.mjs';

const HTML = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

function humanSize(bytes) {
  let value = bytes;
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (value < 1024 || unit === 'TB') {
      return unit === 'B' ? `${value} B` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
}

function jsonResponse(response, value, statusCode = 200) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function formatReviewItems(result) {
  const items = result.items.map(item => ({
    ...item,
    humanSize: humanSize(item.size),
    candidates: item.candidates.map(candidate => ({
      ...candidate,
      humanSize: humanSize(candidate.size),
    })),
  }));
  return { items, filtered: items.length, stats: result.stats };
}

export function startServer(
  databaseFile = DEFAULT_DATABASE,
  { host = '127.0.0.1', port = 8787, repository: injectedRepository } = {},
) {
  const ownsRepository = !injectedRepository;
  const repository = injectedRepository ?? new SqliteReviewRepository(databaseFile);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || host}`);
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(HTML);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/items') {
        jsonResponse(
          response,
          formatReviewItems(await repository.findItems({
            decision: url.searchParams.get('decision') ?? 'pending',
            status: url.searchParams.get('status') ?? 'unmatched',
          })),
        );
        return;
      }

      if (request.method === 'PATCH' && url.pathname === '/api/items') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const { sourcePath, decision } = JSON.parse(body);
        if (!sourcePath || !DECISIONS.has(decision)) {
          throw new ClientError('Expected sourcePath and a valid decision');
        }
        if (!await repository.updateDecision(sourcePath, decision)) {
          throw new ClientError('File not found', 404);
        }
        jsonResponse(response, { ok: true });
        return;
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/media') {
        if (!await serveMedia(request, response, url.searchParams.get('path'))) {
          throw new ClientError('File not found', 404);
        }
        return;
      }

      throw new ClientError('Not found', 404);
    } catch (error) {
      jsonResponse(response, { error: error.message }, error instanceof ClientError ? error.status : 500);
    }
  });

  server.listen(port, host, () => {
    console.log(`Review UI: http://${host}:${server.address().port}`);
  });
  if (ownsRepository) server.once('close', () => repository.close());
  return server;
}

class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
