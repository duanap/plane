import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiSession, runAiTurn } from '../src/ai/session.ts';
import type { Plane } from '../src/game/types.ts';

function planes(prefix: string): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
}

test('AI public knowledge does not receive a destroyed footprint when reveal is disabled', () => {
  const session = createAiSession(planes('h'), 'EASY', {
    firstPlayerId: 'AI',
    aiFleet: planes('a'),
    random: () => 0.025,
    revealDestroyedPlane: false,
  });
  const outcome = runAiTurn(session);
  assert.equal(outcome.result.kind, 'DESTROYED');
  assert.deepEqual(outcome.session.aiObservations[0], {
    position: { x: 2, y: 0 },
    kind: 'DESTROYED',
  });
});

test('AI public knowledge receives the destroyed footprint when reveal is enabled', () => {
  const session = createAiSession(planes('h'), 'EASY', {
    firstPlayerId: 'AI',
    aiFleet: planes('a'),
    random: () => 0.025,
    revealDestroyedPlane: true,
  });
  const outcome = runAiTurn(session);
  assert.equal(outcome.session.aiObservations[0].revealedCells?.length, 10);
});
