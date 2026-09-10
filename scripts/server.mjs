import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function resolvePath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const relative = pathname === '/' ? 'public/index.html' : pathname.replace(/^\//, '');
  const full = normalize(join(root, relative));
  if (!full.startsWith(root)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'plane' }));
    return;
  }

  const path = resolvePath(req.url ?? '/');
  if (!path) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not file');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': contentTypes[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Plane running on http://localhost:${port}`));
