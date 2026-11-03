import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const compiledModulePrefixes = ['/web/', '/game/', '/online/', '/ai/'];

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function roomErrorStatus(code) {
  if (code === 'ROOM_NOT_FOUND') return 404;
  if (code === 'INVALID_TOKEN') return 403;
  if (['ROOM_FULL', 'INVALID_PHASE', 'NOT_YOUR_TURN', 'ALREADY_ATTACKED', 'REMATCH_UNAVAILABLE'].includes(code)) return 409;
  return 400;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body must be valid JSON.');
  }
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const isCompiledModule = compiledModulePrefixes.some((prefix) => decoded.startsWith(prefix));
  const relative = decoded === '/' ? 'public/index.html'
    : isCompiledModule ? decoded.slice(1)
      : join('public', decoded.replace(/^\/+/, ''));
  const base = resolve(root);
  const full = normalize(resolve(base, relative));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function createPlaneServer({ store, root, heartbeatMs = 25_000, cleanupMs = 10 * 60_000 } = {}) {
  if (!store) throw new Error('createPlaneServer requires a RoomStore instance.');
  if (!root) throw new Error('createPlaneServer requires a static root.');

  const subscribers = new Map();

  function subscriberSet(roomId, token, create = false) {
    let room = subscribers.get(roomId);
    if (!room && create) {
      room = new Map();
      subscribers.set(roomId, room);
    }
    let set = room?.get(token);
    if (!set && create) {
      set = new Set();
      room.set(token, set);
    }
    return set;
  }

  function sendSseState(res, view) {
    res.write(`event: state\ndata: ${JSON.stringify({ ok: true, view })}\n\n`);
  }

  function broadcast(roomId) {
    const roomSubscribers = subscribers.get(roomId);
    if (!roomSubscribers) return;
    for (const [token, responses] of roomSubscribers) {
      let view;
      try {
        view = store.getView(roomId, token);
      } catch {
        for (const res of responses) res.end();
        responses.clear();
        continue;
      }
      for (const res of responses) {
        if (!res.writableEnded && !res.destroyed) sendSseState(res, view);
      }
    }
  }

  async function serveStatic(req, res, pathname) {
    const path = safeStaticPath(root, pathname);
    if (!path) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      if (!(await stat(path)).isFile()) throw new Error('Not file');
      const body = await readFile(path);
      res.writeHead(200, {
        'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://plane.local');
    const pathname = url.pathname;

    try {
      if (pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, service: 'plane' });
        return;
      }

      if (pathname === '/api/rooms' && req.method === 'POST') {
        const body = await readJson(req);
        const identity = store.createRoom(body.settings === undefined ? {} : body.settings);
        sendJson(res, 201, { ok: true, identity });
        return;
      }

      const match = pathname.match(/^\/api\/rooms\/([0-9]{6})\/(join|state|fleet|ready|attack|rematch|events)$/);
      if (match) {
        const roomId = match[1];
        const action = match[2];

        if (action === 'join' && req.method === 'POST') {
          const identity = store.joinRoom(roomId);
          sendJson(res, 200, { ok: true, identity });
          broadcast(roomId);
          return;
        }

        if (action === 'state' && req.method === 'GET') {
          const token = url.searchParams.get('token') ?? '';
          sendJson(res, 200, { ok: true, view: store.getView(roomId, token) });
          return;
        }

        if (action === 'events' && req.method === 'GET') {
          const token = url.searchParams.get('token') ?? '';
          store.getView(roomId, token);
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
          subscriberSet(roomId, token, true).add(res);
          store.connectionOpened(roomId, token);
          broadcast(roomId);
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            subscriberSet(roomId, token)?.delete(res);
            try { store.connectionClosed(roomId, token); } catch {}
            broadcast(roomId);
          };
          req.once('close', close);
          res.once('close', close);
          return;
        }

        if (['fleet', 'ready', 'attack', 'rematch'].includes(action) && req.method === 'POST') {
          const body = await readJson(req);
          const token = typeof body.token === 'string' ? body.token : '';
          let extra = {};
          if (action === 'fleet') {
            store.submitFleet(roomId, token, body.planes);
          } else if (action === 'ready') {
            store.ready(roomId, token);
          } else if (action === 'attack') {
            const outcome = store.attack(roomId, token, { x: body.x, y: body.y });
            extra = { result: outcome.result };
          } else {
            store.voteRematch(roomId, token);
          }
          const view = store.getView(roomId, token);
          sendJson(res, 200, { ok: true, ...extra, view });
          broadcast(roomId);
          return;
        }
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'API route not found.' } });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }
      await serveStatic(req, res, pathname);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.name === 'RoomError') {
        sendJson(res, roomErrorStatus(error.code), { ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      console.error(error);
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    }
  });

  let heartbeatTimer;
  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      for (const [roomId, roomSubscribers] of subscribers) {
        let hasOpen = false;
        for (const responses of roomSubscribers.values()) {
          for (const res of responses) {
            if (!res.writableEnded && !res.destroyed) {
              res.write(': heartbeat\n\n');
              hasOpen = true;
            }
          }
        }
        if (hasOpen) {
          try { store.touch(roomId); } catch {}
        }
      }
    }, heartbeatMs);
    heartbeatTimer.unref();
  }

  let cleanupTimer;
  if (cleanupMs > 0) {
    cleanupTimer = setInterval(() => store.cleanup(), cleanupMs);
    cleanupTimer.unref();
  }

  server.once('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (cleanupTimer) clearInterval(cleanupTimer);
  });

  return server;
}
