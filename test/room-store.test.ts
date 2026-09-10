import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomError, RoomStore } from '../src/online/room-store.ts';
import type { Plane } from '../src/game/types.ts';

function planes(prefix: string): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
}

function setup(random = () => 0.1) {
  const tokens = ['ta', 'tb'];
  let now = 1_000;
  const store = new RoomStore({
    code: () => 'ABC234',
    token: () => tokens.shift()!,
    random,
    now: () => now,
  });
  return { store, advance: (ms: number) => { now += ms; } };
}

function readyGame(random = () => 0.1) {
  const { store, advance } = setup(random);
  store.createRoom();
  store.joinRoom('abc234');
  store.submitFleet('ABC234', 'ta', planes('a'));
  store.submitFleet('ABC234', 'tb', planes('b'));
  store.ready('ABC234', 'ta');
  store.ready('ABC234', 'tb');
  return { store, advance };
}

test('create and join allocate A then B and reject a third player', () => {
  const { store } = setup();
  assert.deepEqual(store.createRoom(), { roomId: 'ABC234', playerId: 'A', token: 'ta' });
  assert.deepEqual(store.joinRoom('abc234'), { roomId: 'ABC234', playerId: 'B', token: 'tb' });
  assert.throws(
    () => store.joinRoom('ABC234'),
    (error: unknown) => error instanceof RoomError && error.code === 'ROOM_FULL',
  );
});

test('unknown room and invalid token are rejected', () => {
  const { store } = setup();
  store.createRoom();
  assert.throws(
    () => store.getView('NOPE00', 'ta'),
    (error: unknown) => error instanceof RoomError && error.code === 'ROOM_NOT_FOUND',
  );
  assert.throws(
    () => store.getView('ABC234', 'wrong'),
    (error: unknown) => error instanceof RoomError && error.code === 'INVALID_TOKEN',
  );
});

test('players submit legal fleets and both ready starts the game', () => {
  const { store } = setup(() => 0.1);
  store.createRoom();
  store.joinRoom('ABC234');
  store.submitFleet('ABC234', 'ta', planes('a'));
  store.submitFleet('ABC234', 'tb', planes('b'));
  store.ready('ABC234', 'ta');
  assert.equal(store.getView('ABC234', 'ta').status, 'PLACEMENT');
  store.ready('ABC234', 'tb');
  const view = store.getView('ABC234', 'ta');
  assert.equal(view.status, 'PLAYING');
  assert.equal(view.currentPlayerId, 'A');
  assert.equal(view.players.A.ready, true);
  assert.equal(view.players.B.ready, true);
});

test('ready without a fleet and illegal fleets are rejected', () => {
  const { store } = setup();
  store.createRoom();
  store.joinRoom('ABC234');
  assert.throws(
    () => store.ready('ABC234', 'ta'),
    (error: unknown) => error instanceof RoomError && error.code === 'FLEET_REQUIRED',
  );
  assert.throws(
    () => store.submitFleet('ABC234', 'ta', planes('a').slice(0, 2)),
    (error: unknown) => error instanceof RoomError && error.code === 'INVALID_FLEET',
  );
});

test('public view never exposes an undestroyed opponent fleet', () => {
  const { store } = readyGame();
  const viewA = store.getView('ABC234', 'ta');
  const json = JSON.stringify(viewA);
  assert.deepEqual(viewA.ownFleet?.map((plane) => plane.id), ['a1', 'a2', 'a3']);
  assert.equal(json.includes('b1'), false);
  assert.equal(json.includes('"direction":"UP"'), true); // own fleet is allowed
  assert.equal(json.includes('"x":7,"y":0,"direction"'), false);
  assert.deepEqual(viewA.opponentRevealedPlanes, []);
});

test('wrong player cannot attack and valid attack switches turn', () => {
  const { store } = readyGame(() => 0.1);
  assert.throws(
    () => store.attack('ABC234', 'tb', { x: 0, y: 9 }),
    (error: unknown) => error instanceof RoomError && error.code === 'NOT_YOUR_TURN',
  );
  store.attack('ABC234', 'ta', { x: 0, y: 9 });
  assert.equal(store.getView('ABC234', 'ta').currentPlayerId, 'B');
});

test('attack coordinates must be integer board cells and duplicate attacks are rejected', () => {
  const { store } = readyGame(() => 0.1);
  assert.throws(
    () => store.attack('ABC234', 'ta', { x: 10, y: 0 }),
    (error: unknown) => error instanceof RoomError && error.code === 'INVALID_COORDINATE',
  );
  store.attack('ABC234', 'ta', { x: 0, y: 9 });
  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  assert.throws(
    () => store.attack('ABC234', 'ta', { x: 0, y: 9 }),
    (error: unknown) => error instanceof RoomError && error.code === 'ALREADY_ATTACKED',
  );
});

test('destroyed opponent plane footprint becomes public only after head is hit', () => {
  const { store } = readyGame(() => 0.1);
  const outcome = store.attack('ABC234', 'ta', { x: 2, y: 0 });
  assert.equal(outcome.result.kind, 'DESTROYED');
  const viewA = store.getView('ABC234', 'ta');
  assert.equal(viewA.opponentRevealedPlanes.length, 1);
  assert.equal(viewA.opponentRevealedPlanes[0].cells.length, 10);
  assert.equal(JSON.stringify(viewA.opponentRevealedPlanes).includes('b1'), false);
});

test('destroying all three heads finishes the room and exposes the winner', () => {
  const { store } = readyGame(() => 0.1);
  store.attack('ABC234', 'ta', { x: 2, y: 0 });
  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  store.attack('ABC234', 'ta', { x: 7, y: 0 });
  store.attack('ABC234', 'tb', { x: 1, y: 9 });
  store.attack('ABC234', 'ta', { x: 4, y: 5 });
  const view = store.getView('ABC234', 'ta');
  assert.equal(view.status, 'FINISHED');
  assert.equal(view.winnerId, 'A');
  assert.equal(view.destroyedCounts.B, 3);
  const loserView = store.getView('ABC234', 'tb');
  assert.equal(loserView.opponentRevealedPlanes.length, 3);
  assert.equal(loserView.opponentRevealedPlanes.every((plane) => plane.cells.length === 10), true);
});

test('two rematch votes reset placement state without changing player tokens', () => {
  const { store } = readyGame(() => 0.1);
  store.attack('ABC234', 'ta', { x: 2, y: 0 });
  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  store.attack('ABC234', 'ta', { x: 7, y: 0 });
  store.attack('ABC234', 'tb', { x: 1, y: 9 });
  store.attack('ABC234', 'ta', { x: 4, y: 5 });
  store.voteRematch('ABC234', 'ta');
  assert.equal(store.getView('ABC234', 'ta').rematchVotes.A, true);
  store.voteRematch('ABC234', 'tb');
  const view = store.getView('ABC234', 'ta');
  assert.equal(view.status, 'PLACEMENT');
  assert.equal(view.ownFleet, undefined);
  assert.equal(view.players.A.ready, false);
  assert.equal(view.players.B.ready, false);
  assert.equal(view.rematchVotes.A, false);
});

test('inactive rooms are removed after six hours', () => {
  const { store, advance } = setup();
  store.createRoom();
  advance(6 * 60 * 60 * 1000 + 1);
  assert.equal(store.cleanup(), 1);
  assert.throws(
    () => store.getView('ABC234', 'ta'),
    (error: unknown) => error instanceof RoomError && error.code === 'ROOM_NOT_FOUND',
  );
});

test('attack outcome strips internal plane ids from public result payloads', () => {
  const { store } = readyGame(() => 0.1);
  const bodyHit = store.attack('ABC234', 'ta', { x: 0, y: 1 });
  assert.equal(bodyHit.result.kind, 'HIT');
  assert.equal(JSON.stringify(bodyHit).includes('b1'), false);

  store.attack('ABC234', 'tb', { x: 0, y: 9 });
  const destroyed = store.attack('ABC234', 'ta', { x: 2, y: 0 });
  assert.equal(destroyed.result.kind, 'DESTROYED');
  assert.equal(JSON.stringify(destroyed).includes('b1'), false);
  if (destroyed.result.kind === 'DESTROYED') {
    assert.equal(destroyed.result.revealedCells.length, 10);
  }
});

test('room allocator rejects ambiguous letters that the client room-code parser forbids', () => {
  const codes = ['I23456', 'ABC234'];
  const store = new RoomStore({ code: () => codes.shift()!, token: () => 'ta' });
  assert.equal(store.createRoom().roomId, 'ABC234');
});
