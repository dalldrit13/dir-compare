import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const mimeTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'], ['.avif', 'image/avif'], ['.bmp', 'image/bmp'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
]);

function requestedRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  if (size === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}

export async function serveMedia(request, response, filename) {
  const info = filename ? await stat(filename).catch(() => null) : null;
  if (!info?.isFile()) return false;

  const range = requestedRange(request.headers.range, info.size);
  if (!range) {
    response.writeHead(416, {
      'content-range': `bytes */${info.size}`,
      'accept-ranges': 'bytes',
    });
    response.end();
    return true;
  }

  const headers = {
    'content-type': mimeTypes.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream',
    'content-length': range.end - range.start + 1,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
  };
  if (range.partial) headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`;
  response.writeHead(range.partial ? 206 : 200, headers);

  if (request.method === 'HEAD' || info.size === 0) {
    response.end();
    return true;
  }

  const stream = createReadStream(filename, { start: range.start, end: range.end });
  request.once('aborted', () => stream.destroy());
  stream.on('error', () => response.destroy());
  stream.pipe(response);
  return true;
}
