import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { RoomStore } from '../src/online/room-store.ts';
import { createPlaneServer } from '../scripts/server-core.mjs';

async function startServer() {
  const store = new RoomStore({ code: () => 'ABC234', token: () => 'ta' });
  const server = createPlaneServer({
    store,
    root: fileURLToPath(new URL('../dist/', import.meta.url)),
    heartbeatMs: 0,
    cleanupMs: 0,
  });
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
  return { status: response.status, body: await response.json() };
}

test('room creation transports the host reveal rule into public state', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await json(base, '/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ revealDestroyedPlane: false }),
  });
  assert.equal(created.status, 201);

  const state = await json(base, '/api/rooms/ABC234/state?token=ta');
  assert.equal(state.status, 200);
  assert.equal(state.body.view.rules.revealDestroyedPlane, false);
});

test('room creation rejects a non-boolean reveal rule', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const response = await json(base, '/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ revealDestroyedPlane: 'no' }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_RULES');
});
