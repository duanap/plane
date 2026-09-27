import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLocalFlow, confirmPlacement, endTurn, openTurn, recordAttackResult, startBattle, startSecondPlacement } from '../src/local/flow.ts';

test('local flow starts at setup then Player A placement', () => {
  const setup = beginLocalFlow();
  assert.equal(setup.stage, 'SETUP');
  const placing = { ...setup, stage: 'PLACEMENT_A' as const };
  assert.equal(placing.stage, 'PLACEMENT_A');
});

test('placement requires privacy handoff before Player B sees their board', () => {
  const afterA = confirmPlacement({ stage: 'PLACEMENT_A' });
  assert.equal(afterA.stage, 'HANDOFF_B');
  const b = startSecondPlacement(afterA);
  assert.equal(b.stage, 'PLACEMENT_B');
  const afterB = confirmPlacement(b);
  assert.equal(afterB.stage, 'HANDOFF_BATTLE');
});

test('battle opens through a privacy handoff for the randomized first player', () => {
  const waiting = startBattle({ stage: 'HANDOFF_BATTLE' }, 'B');
  assert.deepEqual(waiting, { stage: 'HANDOFF_TURN', nextPlayer: 'B' });
  const opened = openTurn(waiting);
  assert.deepEqual(opened, { stage: 'PLAYING', activePlayer: 'B' });
});

test('non-final attack enters explicit result stage before handoff', () => {
  const result = recordAttackResult({ stage: 'PLAYING', activePlayer: 'A' }, 'B', false);
  assert.deepEqual(result, { stage: 'TURN_RESULT', activePlayer: 'A', nextPlayer: 'B' });
  const handoff = endTurn(result);
  assert.deepEqual(handoff, { stage: 'HANDOFF_TURN', nextPlayer: 'B' });
});

test('final attack goes straight to finished state', () => {
  const result = recordAttackResult({ stage: 'PLAYING', activePlayer: 'B' }, 'A', true);
  assert.deepEqual(result, { stage: 'FINISHED' });
});
