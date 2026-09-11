import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlacementFleet, dragCandidate, planeAt, rotateCandidate } from '../src/web/placement-model.ts';
import { planeCells, validatePlacement } from '../src/game/geometry.ts';
import type { Plane } from '../src/game/types.ts';

const fleet: Plane[] = [
  { id: 'p1', head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
  { id: 'p2', head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
  { id: 'p3', head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
];

test('placement starts with exactly three legal planes', () => {
  const generated = createPlacementFleet('p', () => 0.42);
  assert.equal(generated.length, 3);
  assert.equal(validatePlacement(generated).valid, true);
});

test('planeAt resolves any occupied body or head cell to its plane', () => {
  const body = planeCells(fleet[0]).find((cell) => cell.kind === 'BODY')!;
  assert.equal(planeAt(fleet, body.position)?.id, 'p1');
  assert.equal(planeAt(fleet, fleet[1].head)?.id, 'p2');
  assert.equal(planeAt(fleet, { x: 9, y: 9 }), undefined);
});

test('drag candidate preserves the grabbed cell offset from the head', () => {
  const grabbed = { x: 0, y: 1 }; // p1 body cell, offset -2,+1 from head 2,0
  const result = dragCandidate(fleet, 'p1', grabbed, { x: 2, y: 4 });
  const moved = result.fleet.find((plane) => plane.id === 'p1')!;
  assert.deepEqual(moved.head, { x: 4, y: 3 });
  assert.equal(result.valid, true);
});

test('illegal drag is exposed as invalid without mutating the original fleet', () => {
  const before = JSON.stringify(fleet);
  const result = dragCandidate(fleet, 'p1', fleet[0].head, { x: 0, y: 0 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'OUT_OF_BOUNDS');
  assert.equal(JSON.stringify(fleet), before);
});

test('legal rotation turns one plane clockwise and illegal rotation is rejected', () => {
  const legalFleet: Plane[] = [
    { id: 'r1', head: { x: 4, y: 4 }, direction: 'UP', destroyed: false },
    { id: 'r2', head: { x: 8, y: 0 }, direction: 'RIGHT', destroyed: false },
    { id: 'r3', head: { x: 1, y: 8 }, direction: 'LEFT', destroyed: false },
  ];
  assert.equal(validatePlacement(legalFleet).valid, true);
  const legal = rotateCandidate(legalFleet, 'r1');
  assert.equal(legal.valid, true);
  assert.equal(legal.fleet.find((plane) => plane.id === 'r1')?.direction, 'RIGHT');

  const edgeFleet: Plane[] = [
    { id: 'e1', head: { x: 2, y: 0 }, direction: 'UP', destroyed: false },
    { id: 'e2', head: { x: 7, y: 0 }, direction: 'UP', destroyed: false },
    { id: 'e3', head: { x: 4, y: 5 }, direction: 'DOWN', destroyed: false },
  ];
  const illegal = rotateCandidate(edgeFleet, 'e1');
  assert.equal(illegal.valid, false);
  assert.deepEqual(illegal.fleet, edgeFleet);
});
