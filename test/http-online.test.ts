import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { RoomStore } from '../src/online/room-store.ts';
import { createPlaneServer } from '../scripts/server-core.mjs';
import type { Plane } from '../src/game/types.ts';

function planes(prefix: string): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
}

async function startServer() {
  const codes = ['ABC234'];
  const tokens = ['ta', 'tb'];
  const store = new RoomStore({ code: () => codes.shift()!, token: () => tokens.shift()!, random: () => 0.1 });
  const server = createPlaneServer({ store, root: fileURLToPath(new URL('../dist/', import.meta.url)), heartbeatMs: 0, cleanupMs: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function json(base: string, path: string, init: RequestInit = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('\n\n')) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream ended');
    buffer += decoder.decode(value, { stream: true });
  }
  const block = buffer.slice(0, buffer.indexOf('\n\n'));
  const data = block.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  return data ? JSON.parse(data) : null;
}

test('HTTP API creates, joins, places, readies and returns sanitized state', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await json(base, '/api/rooms', { method: 'POST' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.identity, { roomId: 'ABC234', playerId: 'A', token: 'ta' });

  const joined = await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.identity.playerId, 'B');

  await json(base, '/api/rooms/ABC234/fleet', { method: 'POST', body: JSON.stringify({ token: 'ta', planes: planes('a') }) });
  await json(base, '/api/rooms/ABC234/fleet', { method: 'POST', body: JSON.stringify({ token: 'tb', planes: planes('b') }) });
  await json(base, '/api/rooms/ABC234/ready', { method: 'POST', body: JSON.stringify({ token: 'ta' }) });
  await json(base, '/api/rooms/ABC234/ready', { method: 'POST', body: JSON.stringify({ token: 'tb' }) });

  const state = await json(base, '/api/rooms/ABC234/state?token=ta');
  assert.equal(state.status, 200);
  assert.equal(state.body.view.status, 'PLAYING');
  assert.equal(state.body.view.currentPlayerId, 'A');
  assert.equal(JSON.stringify(state.body).includes('b1'), false);
});

test('expected room errors use stable JSON error envelopes', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });
  const response = await json(base, '/api/rooms/ABC234/state?token=bad');
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { ok: false, error: { code: 'INVALID_TOKEN', message: 'Player token is invalid for this room.' } });
});

test('SSE sends a new player-specific state after another player mutates the room', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const streamResponse = await fetch(`${base}/api/rooms/ABC234/events?token=ta`, { signal: controller.signal });
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body!.getReader();
  const initial = await readEvent(reader);
  assert.equal(initial.view.players.B.joined, false);

  await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  const update = await readEvent(reader);
  assert.equal(update.view.players.B.joined, true);
  assert.equal(update.view.status, 'PLACEMENT');
});

test('malformed fleet payload is rejected as a client error instead of crashing the server', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });
  await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  const response = await json(base, '/api/rooms/ABC234/fleet', { method: 'POST', body: JSON.stringify({ token: 'ta' }) });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_FLEET');
});

test('valid JSON with a non-object body is rejected safely instead of producing a 500', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });
  await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  const response = await json(base, '/api/rooms/ABC234/ready', { method: 'POST', body: 'null' });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'INVALID_TOKEN');
});

test('malformed plane objects are rejected as INVALID_FLEET instead of reaching geometry code', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });
  await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  const response = await json(base, '/api/rooms/ABC234/fleet', {
    method: 'POST',
    body: JSON.stringify({ token: 'ta', planes: [null, null, null] }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_FLEET');
});

test('HTTP attack endpoint resolves turns and returns only public attack data', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await json(base, '/api/rooms', { method: 'POST' });
  await json(base, '/api/rooms/ABC234/join', { method: 'POST' });
  await json(base, '/api/rooms/ABC234/fleet', { method: 'POST', body: JSON.stringify({ token: 'ta', planes: planes('a') }) });
  await json(base, '/api/rooms/ABC234/fleet', { method: 'POST', body: JSON.stringify({ token: 'tb', planes: planes('b') }) });
  await json(base, '/api/rooms/ABC234/ready', { method: 'POST', body: JSON.stringify({ token: 'ta' }) });
  await json(base, '/api/rooms/ABC234/ready', { method: 'POST', body: JSON.stringify({ token: 'tb' }) });

  const hit = await json(base, '/api/rooms/ABC234/attack', {
    method: 'POST',
    body: JSON.stringify({ token: 'ta', x: 0, y: 1 }),
  });
  assert.equal(hit.status, 200);
  assert.equal(hit.body.result.kind, 'HIT');
  assert.equal(hit.body.view.currentPlayerId, 'B');
  assert.equal(JSON.stringify(hit.body).includes('b1'), false);

  await json(base, '/api/rooms/ABC234/attack', {
    method: 'POST',
    body: JSON.stringify({ token: 'tb', x: 0, y: 9 }),
  });
  const destroyed = await json(base, '/api/rooms/ABC234/attack', {
    method: 'POST',
    body: JSON.stringify({ token: 'ta', x: 2, y: 0 }),
  });
  assert.equal(destroyed.body.result.kind, 'DESTROYED');
  assert.equal(destroyed.body.result.revealedCells.length, 10);
  assert.equal(JSON.stringify(destroyed.body).includes('b1'), false);
});
