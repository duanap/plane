import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomStore } from '../src/online/room-store.ts';
import type { Plane } from '../src/game/types.ts';

function planes(prefix: string): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
}

function readyGame(revealDestroyedPlane: boolean) {
  const tokens = ['ta', 'tb'];
  const store = new RoomStore({ code: () => 'ABC234', token: () => tokens.shift()!, random: () => 0.1 });
  store.createRoom({ revealDestroyedPlane });
  store.joinRoom('ABC234');
  store.submitFleet('ABC234', 'ta', planes('a'));
  store.submitFleet('ABC234', 'tb', planes('b'));
  store.ready('ABC234', 'ta');
  store.ready('ABC234', 'tb');
  return store;
}

test('room view exposes the host-selected reveal rule to both players', () => {
  const store = readyGame(false);
  assert.equal(store.getView('ABC234', 'ta').rules.revealDestroyedPlane, false);
  assert.equal(store.getView('ABC234', 'tb').rules.revealDestroyedPlane, false);
});

test('reveal off hides destroyed body footprint during play', () => {
  const store = readyGame(false);
  const outcome = store.attack('ABC234', 'ta', { x: 2, y: 0 });
  assert.deepEqual(outcome.result, { kind: 'DESTROYED' });
  assert.deepEqual(store.getView('ABC234', 'ta').opponentRevealedPlanes, []);
});

test('reveal on publishes the full destroyed 10-cell footprint during play', () => {
  const store = readyGame(true);
  const outcome = store.attack('ABC234', 'ta', { x: 2, y: 0 });
  assert.equal(outcome.result.kind, 'DESTROYED');
  assert.equal('revealedCells' in outcome.result && outcome.result.revealedCells.length, 10);
  assert.equal(store.getView('ABC234', 'ta').opponentRevealedPlanes[0].cells.length, 10);
});

test('final result reveals complete fleets even when reveal during play is off', () => {
  const store = readyGame(false);
  store.attack('ABC234', 'ta', { x: 2, y: 0 });
  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  store.attack('ABC234', 'ta', { x: 7, y: 0 });
  store.attack('ABC234', 'tb', { x: 1, y: 9 });
  store.attack('ABC234', 'ta', { x: 4, y: 5 });
  const view = store.getView('ABC234', 'ta');
  assert.equal(view.status, 'FINISHED');
  assert.equal(view.opponentRevealedPlanes.length, 3);
  assert.equal(view.opponentRevealedPlanes.every((plane) => plane.cells.length === 10), true);
});

test('rematch keeps the room reveal rule', () => {
  const store = readyGame(false);
  store.attack('ABC234', 'ta', { x: 2, y: 0 });
  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  store.attack('ABC234', 'ta', { x: 7, y: 0 });
  store.attack('ABC234', 'tb', { x: 1, y: 9 });
  store.attack('ABC234', 'ta', { x: 4, y: 5 });
  store.voteRematch('ABC234', 'ta');
  store.voteRematch('ABC234', 'tb');
  assert.equal(store.getView('ABC234', 'ta').rules.revealDestroyedPlane, false);
});
