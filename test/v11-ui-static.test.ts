import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('local mode wires shared rule drag placement and explicit end-turn handoff', async () => {
  const local = await source('src/web/main.ts');
  assert.match(local, /revealDestroyedPlane/);
  assert.match(local, /dragCandidate/);
  assert.match(local, /rotateCandidate/);
  assert.match(local, /TURN_RESULT/);
  assert.match(local, /结束回合/);
  assert.match(local, /开始我的回合/);
});

test('online host sends the reveal rule and placement uses drag model', async () => {
  const online = await source('src/web/online.ts');
  assert.match(online, /JSON\.stringify\(\{ revealDestroyedPlane: hostRevealRule \}\)/);
  assert.match(online, /view\.rules\.revealDestroyedPlane/);
  assert.match(online, /dragCandidate/);
  assert.match(online, /rotateCandidate/);
});

test('AI settings pass the reveal rule into the AI session and use drag placement', async () => {
  const ai = await source('src/web/ai.ts');
  assert.match(ai, /createAiSession\(humanFleet, difficulty, \{ revealDestroyedPlane \}\)/);
  assert.match(ai, /dragCandidate/);
  assert.match(ai, /rotateCandidate/);
  assert.match(ai, /击落后显示完整轮廓/);
  assert.match(ai, /击落后不显示轮廓/);
});

test('shared styles distinguish miss hit and destroyed marks and disable touch scrolling while dragging', async () => {
  const css = await source('public/styles.css');
  assert.match(css, /\.cell\.miss::after/);
  assert.match(css, /\.cell\.hit::after/);
  assert.match(css, /\.cell\.destroyed::after/);
  assert.match(css, /animation:\s*destroyed-pop/);
  assert.match(css, /\.placement-board\s*\{[^}]*touch-action:\s*none/s);
});
