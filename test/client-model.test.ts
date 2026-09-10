import test from 'node:test';
import assert from 'node:assert/strict';
import { coordLabel, isRoomCode, normalizeRoomCode, canAttackCell, attackClassFor, revealedCellKindFor } from '../src/online/client-model.ts';
import type { PublicRoomView } from '../src/online/room-store.ts';

const view: PublicRoomView = {
  roomId: 'ABC234',
  status: 'PLAYING',
  playerId: 'A',
  players: { A: { joined: true, ready: true, connected: true }, B: { joined: true, ready: true, connected: true } },
  currentPlayerId: 'A',
  attacks: [
    { attackerId: 'A', targetId: 'B', position: { x: 0, y: 0 }, kind: 'MISS' },
    { attackerId: 'B', targetId: 'A', position: { x: 1, y: 1 }, kind: 'HIT' },
  ],
  opponentRevealedPlanes: [],
  destroyedCounts: { A: 0, B: 0 },
  rematchVotes: { A: false, B: false },
};

test('room code input is normalized and validated', () => {
  assert.equal(normalizeRoomCode(' abc234 '), 'ABC234');
  assert.equal(isRoomCode('ABC234'), true);
  assert.equal(isRoomCode('ABC123'), false);
});

test('coordinate labels use A-J rows and 1-10 columns', () => {
  assert.equal(coordLabel({ x: 0, y: 0 }), 'A1');
  assert.equal(coordLabel({ x: 9, y: 9 }), 'J10');
});

test('attack availability requires playing state, caller turn and an unused cell', () => {
  assert.equal(canAttackCell(view, { x: 2, y: 2 }), true);
  assert.equal(canAttackCell(view, { x: 0, y: 0 }), false);
  assert.equal(canAttackCell({ ...view, currentPlayerId: 'B' }, { x: 2, y: 2 }), false);
});

test('attack class is derived only from visible attack history for the requested board', () => {
  assert.equal(attackClassFor(view, 'ENEMY', { x: 0, y: 0 }), 'miss');
  assert.equal(attackClassFor(view, 'OWN', { x: 1, y: 1 }), 'hit');
  assert.equal(attackClassFor(view, 'ENEMY', { x: 1, y: 1 }), undefined);
});


test('revealed opponent plane cells expose only their visible head/body shape', () => {
  const finished: PublicRoomView = {
    ...view,
    status: 'FINISHED',
    winnerId: 'B',
    opponentRevealedPlanes: [{ cells: [
      { kind: 'HEAD', position: { x: 4, y: 2 } },
      { kind: 'BODY', position: { x: 4, y: 3 } },
    ] }],
  };
  assert.equal(revealedCellKindFor(finished, 'ENEMY', { x: 4, y: 2 }), 'HEAD');
  assert.equal(revealedCellKindFor(finished, 'ENEMY', { x: 4, y: 3 }), 'BODY');
  assert.equal(revealedCellKindFor(finished, 'OWN', { x: 4, y: 2 }), undefined);
});
