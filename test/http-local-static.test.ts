import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoomStore } from '../src/online/room-store.ts';
import { createPlaneServer } from '../scripts/server-core.mjs';

test('compiled local flow modules are served from dist/local', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'plane-local-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public'), { recursive: true });
  await mkdir(join(root, 'local'), { recursive: true });
  await writeFile(join(root, 'local', 'probe.js'), "export const source = 'local';\n");

  const server = createPlaneServer({ store: new RoomStore(), root, heartbeatMs: 0, cleanupMs: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');

  const response = await fetch(`http://127.0.0.1:${address.port}/local/probe.js`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "export const source = 'local';\n");
});
