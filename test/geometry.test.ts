import test from 'node:test';
import assert from 'node:assert/strict';
import { planeCells, validatePlacement, isInsideBoard } from '../src/game/geometry.ts';
import type { Plane } from '../src/game/types.ts';

const up: Plane = { id: 'p1', head: { x: 4, y: 2 }, direction: 'UP', destroyed: false };

test('UP plane has exactly 10 cells with 1 head and 9 body cells', () => {
  const cells = planeCells(up);
  assert.equal(cells.length, 10);
  assert.equal(cells.filter((c) => c.kind === 'HEAD').length, 1);
  assert.equal(cells.filter((c) => c.kind === 'BODY').length, 9);
  assert.deepEqual(cells.find((c) => c.kind === 'HEAD')?.position, { x: 4, y: 2 });
});

test('rotations preserve the 10-cell footprint and rotate around the head', () => {
  const right = planeCells({ ...up, direction: 'RIGHT' });
  const down = planeCells({ ...up, direction: 'DOWN' });
  const left = planeCells({ ...up, direction: 'LEFT' });
  assert.equal(right.length, 10);
  assert.equal(down.length, 10);
  assert.equal(left.length, 10);
  assert(right.some((c) => c.position.x === 1 && c.position.y === 2));
  assert(down.some((c) => c.position.x === 4 && c.position.y === -1));
  assert(left.some((c) => c.position.x === 7 && c.position.y === 2));
});

test('board coordinates are inside only for x/y 0 through 9', () => {
  assert.equal(isInsideBoard({ x: 0, y: 0 }), true);
  assert.equal(isInsideBoard({ x: 9, y: 9 }), true);
  assert.equal(isInsideBoard({ x: -1, y: 0 }), false);
  assert.equal(isInsideBoard({ x: 10, y: 9 }), false);
});

test('placement rejects any plane that leaves the board', () => {
  const invalid: Plane = { id: 'p1', head: { x: 1, y: 1 }, direction: 'UP', destroyed: false };
  assert.deepEqual(validatePlacement([invalid]), { valid: false, reason: 'OUT_OF_BOUNDS' });
});

test('placement rejects overlapping planes', () => {
  const p1: Plane = { id: 'p1', head: { x: 4, y: 1 }, direction: 'UP', destroyed: false };
  const p2: Plane = { id: 'p2', head: { x: 4, y: 1 }, direction: 'UP', destroyed: false };
  assert.deepEqual(validatePlacement([p1, p2]), { valid: false, reason: 'OVERLAP' });
});

test('placement allows planes to touch without sharing a cell', () => {
  const p1: Plane = { id: 'p1', head: { x: 2, y: 0 }, direction: 'UP', destroyed: false };
  const p2: Plane = { id: 'p2', head: { x: 7, y: 0 }, direction: 'UP', destroyed: false };
  assert.deepEqual(validatePlacement([p1, p2]), { valid: true });
});

test('randomFleet produces exactly three legal planes', async () => {
  const { randomFleet } = await import('../src/game/geometry.ts');
  for (let i = 0; i < 50; i += 1) {
    const fleet = randomFleet('r');
    assert.equal(fleet.length, 3);
    assert.deepEqual(validatePlacement(fleet), { valid: true });
  }
});
