import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFleet, draggedHead, gridPosition, movePlane, overlapPositions, rotatePlane } from '../src/game/fleet-placement.ts';
import { planeCells, validatePlacement } from '../src/game/geometry.ts';
import { RoomStore } from '../src/online/room-store.ts';
import { fleetBoard } from '../src/web/fleet-editor.ts';

test('default fleets contain three legal, independent planes with namespaced ids', () => {
  const a = defaultFleet('a');
  const b = defaultFleet('b');
  assert.equal(a.length, 3);
  assert.equal(validatePlacement(a).valid, true);
  assert.equal(validatePlacement(b).valid, true);
  assert.equal(new Set([...a, ...b].map((plane) => plane.id)).size, 6);
  a[0].head.x = 9;
  assert.equal(defaultFleet('a')[0].head.x, 2);
  assert.equal(b[0].head.x, 2);
});

test('dragging a wing preserves the grabbed offset instead of snapping the head to the pointer', () => {
  const head = { x: 2, y: 1 };
  assert.deepEqual(draggedHead(head, { x: 0, y: 2 }, { x: 1, y: 3 }), { x: 3, y: 2 });
  assert.deepEqual(head, { x: 2, y: 1 });
});

test('pointer conversion respects board origin and rectangular bounds, including out-of-board drops', () => {
  const bounds = { left: 20, top: 40, width: 500, height: 400 };
  assert.deepEqual(gridPosition(145, 140, bounds), { x: 2, y: 2 });
  assert.deepEqual(gridPosition(19, 39, bounds), { x: -1, y: -1 });
  assert.deepEqual(gridPosition(520, 440, bounds), { x: 10, y: 10 });
});

test('a valid move changes only the chosen plane and preserves the old fleet for undo', () => {
  const fleet = defaultFleet();
  const original = structuredClone(fleet);
  const edited = movePlane(fleet, 'p1', { x: 2, y: 0 });
  assert.equal(edited.valid, true);
  if (!edited.valid) return;
  assert.deepEqual(edited.fleet[0].head, { x: 2, y: 0 });
  assert.deepEqual(edited.fleet.slice(1), fleet.slice(1));
  assert.deepEqual(fleet, original);
  assert.equal(validatePlacement(edited.fleet).valid, true);
});

test('out-of-bounds and fractional moves are rejected without changing the fleet', () => {
  const fleet = defaultFleet();
  const original = structuredClone(fleet);
  assert.deepEqual(movePlane(fleet, 'p1', { x: 0, y: 0 }), { valid: false, reason: 'OUT_OF_BOUNDS' });
  assert.deepEqual(movePlane(fleet, 'p1', { x: 2.5, y: 1 }), { valid: false, reason: 'OUT_OF_BOUNDS' });
  assert.deepEqual(movePlane(fleet, 'missing', { x: 2, y: 1 }), { valid: false, reason: 'UNKNOWN_PLANE' });
  assert.deepEqual(fleet, original);
});

test('rotation moves an edge plane inward while keeping ten cells and a legal layout', () => {
  const fleet = defaultFleet();
  const original = structuredClone(fleet);
  const rotated = rotatePlane(fleet, 'p1');
  assert.equal(rotated.valid, true);
  if (!rotated.valid) return;
  assert.equal(rotated.fleet[0].direction, 'RIGHT');
  assert.deepEqual(rotated.fleet[0].head, { x: 3, y: 2 });
  assert.equal(planeCells(rotated.fleet[0]).length, 10);
  assert.equal(validatePlacement(rotated.fleet).valid, true);
  assert.deepEqual(fleet, original);
});

test('rotation can create an overlapping draft while final validation still rejects it', () => {
  const fleet = defaultFleet();
  const original = structuredClone(fleet);
  const result = rotatePlane(fleet, 'p2');
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.fleet[1].direction, 'RIGHT');
  assert.deepEqual(validatePlacement(result.fleet), { valid: false, reason: 'OVERLAP' });
  assert.equal(overlapPositions(result.fleet).length, 1);
  assert.deepEqual(fleet, original);
});

test('an overlapping draft can be resolved by moving a plane, including one not in the overlap', () => {
  const rotated = rotatePlane(defaultFleet(), 'p2');
  assert.equal(rotated.valid, true);
  if (!rotated.valid) return;
  const unrelated = movePlane(rotated.fleet, 'p3', { x: 4, y: 9 });
  assert.equal(unrelated.valid, true);
  const resolved = movePlane(rotated.fleet, 'p2', { x: 8, y: 2 });
  assert.equal(resolved.valid, true);
  if (!resolved.valid) return;
  assert.equal(validatePlacement(resolved.fleet).valid, true);
  assert.equal(overlapPositions(resolved.fleet).length, 0);
});

test('fully overlapping planes remain selectable and can be separated', () => {
  const draft = movePlane(defaultFleet(), 'p1', { x: 7, y: 1 });
  assert.equal(draft.valid, true);
  if (!draft.valid) return;
  assert.equal(overlapPositions(draft.fleet).length, 10);
  const first = fleetBoard(draft.fleet, 'p1');
  const second = fleetBoard(draft.fleet, 'p2');
  assert.match(first, /data-x="7" data-y="1" data-plane-index="0" data-plane-indices="0,1"/);
  assert.match(second, /data-x="7" data-y="1" data-plane-index="1" data-plane-indices="0,1"/);
  assert.match(first, /10 格重叠/);
  const resolved = movePlane(draft.fleet, 'p1', { x: 2, y: 1 });
  assert.equal(resolved.valid, true);
  if (resolved.valid) assert.equal(validatePlacement(resolved.fleet).valid, true);
});

test('server refuses an overlapping draft and accepts the resolved layout', () => {
  let tokens = 0;
  const store = new RoomStore({ code: () => '012345', token: () => ++tokens === 1 ? 'ta' : 'tb' });
  store.createRoom();
  store.joinRoom('012345');
  const rotated = rotatePlane(defaultFleet(), 'p2');
  assert.equal(rotated.valid, true);
  if (!rotated.valid) return;
  assert.throws(() => store.submitFleet('012345', 'ta', rotated.fleet), { code: 'INVALID_FLEET' });
  assert.equal(store.getView('012345', 'ta').players.A.ready, false);
  const resolved = movePlane(rotated.fleet, 'p2', { x: 8, y: 2 });
  assert.equal(resolved.valid, true);
  if (!resolved.valid) return;
  store.submitFleet('012345', 'ta', resolved.fleet);
  store.ready('012345', 'ta');
  assert.equal(store.getView('012345', 'ta').players.A.ready, true);
});

test('four rotations in open space return to the same head and direction', () => {
  let fleet = [defaultFleet()[0]];
  fleet[0].head = { x: 4, y: 4 };
  const original = structuredClone(fleet);
  for (let count = 0; count < 4; count++) {
    const result = rotatePlane(fleet, 'p1');
    assert.equal(result.valid, true);
    if (result.valid) fleet = result.fleet;
  }
  assert.deepEqual(fleet, original);
});
