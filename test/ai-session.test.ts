import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiSession, humanAttack, runAiTurn, AiSessionError } from '../src/ai/session.ts';
import type { Plane } from '../src/game/types.ts';

function fleet(prefix: string): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
}

test('creates a legal session with chosen difficulty and first player', () => {
  const session = createAiSession(fleet('h'), 'NORMAL', { aiFleet: fleet('a'), firstPlayerId: 'HUMAN', random: () => 0 });
  assert.equal(session.difficulty, 'NORMAL');
  assert.equal(session.game.currentPlayerId, 'HUMAN');
  assert.equal(session.aiObservations.length, 0);
});

test('human attack is rejected when it is AI turn', () => {
  const session = createAiSession(fleet('h'), 'EASY', { aiFleet: fleet('a'), firstPlayerId: 'AI', random: () => 0 });
  assert.throws(() => humanAttack(session, { x: 0, y: 9 }), (error: unknown) => error instanceof AiSessionError && error.code === 'NOT_HUMAN_TURN');
});

test('AI turn appends only public attack observation', () => {
  const session = createAiSession(fleet('h'), 'EASY', { aiFleet: fleet('a'), firstPlayerId: 'AI', random: () => 0 });
  const outcome = runAiTurn(session);
  assert.equal(outcome.session.aiObservations.length, 1);
  assert.deepEqual(outcome.session.aiObservations[0].position, outcome.position);
  assert(['MISS','HIT','DESTROYED'].includes(outcome.session.aiObservations[0].kind));
  assert.equal('planes' in outcome.session.aiObservations[0], false);
});

test('AI never attacks the same coordinate twice across its turns', () => {
  let session = createAiSession(fleet('h'), 'EASY', { aiFleet: fleet('a'), firstPlayerId: 'AI', random: () => 0 });
  const first = runAiTurn(session);
  session = first.session;
  session = humanAttack(session, { x: 0, y: 9 }).session;
  const second = runAiTurn(session);
  assert.notDeepEqual(second.position, first.position);
});

test('human can win by destroying all three AI heads', () => {
  let session = createAiSession(fleet('h'), 'EASY', { aiFleet: fleet('a'), firstPlayerId: 'HUMAN', random: () => 0 });
  for (const head of [{x:2,y:0},{x:7,y:0},{x:4,y:5}]) {
    session = humanAttack(session, head).session;
    if (session.game.status === 'FINISHED') break;
    session = runAiTurn(session).session;
  }
  assert.equal(session.game.status, 'FINISHED');
  assert.equal(session.game.winnerId, 'HUMAN');
});
