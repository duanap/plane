import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('home is a three-mode selector and local play lives at /local.html', async () => {
  const [home, local] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/local.html', import.meta.url), 'utf8'),
  ]);

  assert.match(home, /href="\/local\.html"/);
  assert.match(home, /href="\/online\.html"/);
  assert.match(home, /href="\/ai\.html"/);
  assert.match(home, /本地双人/);
  assert.match(home, /在线对战/);
  assert.match(home, /AI 练习/);
  assert.doesNotMatch(home, /\/web\/main\.js/);

  assert.match(local, /\/web\/main\.js/);
  assert.match(local, /本地双人/);
});
