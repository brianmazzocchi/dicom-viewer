import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { resolveInside } from './paths';

type ListedFile = { rel: string; size: number };

function contentType(relativePath: string): string {
  if (/\.jpe?g$/i.test(relativePath)) return 'image/jpeg';
  if (/\.png$/i.test(relativePath)) return 'image/png';
  return 'application/dicom';
}

async function listFiles(root: string): Promise<ListedFile[]> {
  const files: ListedFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(absolute);
        files.push({
          rel: path.relative(root, absolute).split(path.sep).join('/'),
          size: stat.size,
        });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
  return files;
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

function libraryAvailable(root: string | undefined): root is string {
  if (!root) return false;
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

export function libraryPlugin(libraryPath: string | undefined): Plugin {
  const root = libraryPath ? path.resolve(libraryPath) : undefined;
  let listed: Promise<ListedFile[]> | undefined;

  return {
    name: 'local-dicom-library',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response, next).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Library error';
          sendJson(response, { error: message }, 500);
        });
      });
    },
  };

  async function handle(request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }
    if (!libraryAvailable(root)) {
      if (url.pathname === '/api/library') {
        sendJson(response, { available: false });
        return;
      }
      sendJson(response, { error: 'Library path is not configured' }, 404);
      return;
    }

    if (url.pathname === '/api/library') {
      sendJson(response, { available: true, name: path.basename(root) });
      return;
    }

    if (url.pathname === '/api/files') {
      listed ??= listFiles(root);
      const files = await listed;
      sendJson(response, { files });
      return;
    }

    if (url.pathname === '/api/file') {
      const relativePath = url.searchParams.get('rel');
      if (!relativePath) {
        sendJson(response, { error: 'Missing rel' }, 400);
        return;
      }
      const absolute = resolveInside(root, relativePath);
      const stat = await fs.promises.stat(absolute);
      response.setHeader('Content-Type', contentType(relativePath));
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Cache-Control', 'no-store');

      const range = request.headers.range;
      const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) {
          response.statusCode = 416;
          response.end();
          return;
        }
        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        response.setHeader('Content-Length', String(end - start + 1));
        fs.createReadStream(absolute, { start, end }).pipe(response);
        return;
      }

      response.setHeader('Content-Length', String(stat.size));
      fs.createReadStream(absolute).pipe(response);
      return;
    }

    sendJson(response, { error: 'Not found' }, 404);
  }
}
