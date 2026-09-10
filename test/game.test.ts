import test from 'node:test';
import assert from 'node:assert/strict';
import { attack, createGame, GameRuleError } from '../src/game/game.ts';
import type { Plane } from '../src/game/types.ts';

function planes(prefix: string, shift = 0): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 0 + shift }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 0 + shift }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 5 + shift }, direction: 'DOWN', destroyed: false },
  ];
}

function baseGame() {
  return createGame(
    [
      { id: 'A', planes: planes('a') },
      { id: 'B', planes: planes('b') },
    ],
    'A',
  );
}

test('createGame starts in PLAYING with the chosen first player', () => {
  const game = baseGame();
  assert.equal(game.status, 'PLAYING');
  assert.equal(game.currentPlayerId, 'A');
  assert.equal(game.attacks.length, 0);
});

test('attack on empty cell returns MISS and switches turn', () => {
  const game = baseGame();
  const outcome = attack(game, { x: 0, y: 9 });
  assert.equal(outcome.result.kind, 'MISS');
  assert.equal(outcome.game.currentPlayerId, 'B');
  assert.equal(outcome.game.attacks.length, 1);
});

test('attack on body returns HIT and leaves plane alive', () => {
  const game = baseGame();
  const outcome = attack(game, { x: 0, y: 1 });
  assert.equal(outcome.result.kind, 'HIT');
  assert.equal(outcome.result.planeId, 'b1');
  assert.equal(outcome.game.players[1].planes[0].destroyed, false);
});

test('attack on head destroys the plane and reveals all 10 cells', () => {
  const game = baseGame();
  const outcome = attack(game, { x: 2, y: 0 });
  assert.equal(outcome.result.kind, 'DESTROYED');
  assert.equal(outcome.result.planeId, 'b1');
  assert.equal(outcome.game.players[1].planes[0].destroyed, true);
  assert.equal(outcome.result.revealedCells.length, 10);
});

test('duplicate attack is rejected without changing turn or history', () => {
  const first = attack(baseGame(), { x: 0, y: 9 }).game;
  const second = attack(first, { x: 9, y: 9 }).game;
  assert.equal(second.currentPlayerId, 'A');
  assert.equal(second.attacks.length, 2);

  assert.throws(
    () => attack(second, { x: 0, y: 9 }),
    (error: unknown) => error instanceof GameRuleError && error.code === 'ALREADY_ATTACKED',
  );
  assert.equal(second.currentPlayerId, 'A');
  assert.equal(second.attacks.length, 2);
});

test('player may not attack after game has finished', () => {
  let game = baseGame();
  game = attack(game, { x: 2, y: 0 }).game;
  game = attack(game, { x: 9, y: 9 }).game;
  game = attack(game, { x: 7, y: 0 }).game;
  game = attack(game, { x: 8, y: 9 }).game;
  const final = attack(game, { x: 4, y: 5 });

  assert.equal(final.game.status, 'FINISHED');
  assert.equal(final.game.winnerId, 'A');
  assert.throws(
    () => attack(final.game, { x: 1, y: 9 }),
    (error: unknown) => error instanceof GameRuleError && error.code === 'GAME_FINISHED',
  );
});

test('createGame rejects a player without exactly three legal planes', () => {
  assert.throws(
    () => createGame([{ id: 'A', planes: planes('a').slice(0, 2) }, { id: 'B', planes: planes('b') }], 'A'),
    (error: unknown) => error instanceof GameRuleError && error.code === 'INVALID_FLEET',
  );
});
