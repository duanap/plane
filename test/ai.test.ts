import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAiAttack, enumeratePlaneCandidates } from '../src/ai/ai.ts';
import type { AiObservation } from '../src/ai/ai.ts';
import { planeCells } from '../src/game/geometry.ts';

const key = (p: {x:number;y:number}) => `${p.x}:${p.y}`;

test('easy never repeats an attacked coordinate', () => {
  const observations: AiObservation[] = [{ position: {x:0,y:0}, kind:'MISS' }];
  assert.notEqual(key(chooseAiAttack('EASY', observations, () => 0)), '0:0');
});

test('normal prefers an untried coordinate near an unresolved hit', () => {
  const observations: AiObservation[] = [{ position: {x:4,y:4}, kind:'HIT' }];
  const p = chooseAiAttack('NORMAL', observations, () => 0);
  assert.equal(Math.abs(p.x-4)+Math.abs(p.y-4), 1);
});

test('candidate enumeration contains only legal 10-cell planes', () => {
  const candidates = enumeratePlaneCandidates();
  assert(candidates.length > 0);
  assert(candidates.every((candidate) => candidate.cells.length === 10));
  assert(candidates.every((candidate) => candidate.cells.every((c) => c.position.x >= 0 && c.position.x < 10 && c.position.y >= 0 && c.position.y < 10)));
});

test('hard never selects a known miss or other attacked coordinate', () => {
  const observations: AiObservation[] = [
    { position: {x:4,y:4}, kind:'MISS' },
    { position: {x:5,y:5}, kind:'HIT' },
  ];
  const p = chooseAiAttack('HARD', observations, () => 0);
  assert.notEqual(key(p), '4:4');
  assert.notEqual(key(p), '5:5');
});

test('hard changes its scoring when hit evidence is present', () => {
  const noEvidence = chooseAiAttack('HARD', [], () => 0);
  const withHit = chooseAiAttack('HARD', [{ position: {x:4,y:4}, kind:'HIT' }], () => 0);
  assert.notDeepEqual(withHit, noEvidence);
});

test('all difficulty levels return in-board coordinates', () => {
  for (const difficulty of ['EASY','NORMAL','HARD'] as const) {
    const p = chooseAiAttack(difficulty, [], () => 0.42);
    assert(p.x >= 0 && p.x < 10 && p.y >= 0 && p.y < 10);
  }
});

test('normal ignores hits that belong to an already destroyed footprint', () => {
  const destroyed = planeCells({ id: 'dead', head: { x: 4, y: 3 }, direction: 'UP', destroyed: true });
  const observations: AiObservation[] = [
    { position: { x: 4, y: 4 }, kind: 'HIT' },
    { position: { x: 4, y: 3 }, kind: 'DESTROYED', revealedCells: destroyed },
    { position: { x: 8, y: 8 }, kind: 'HIT' },
  ];
  const p = chooseAiAttack('NORMAL', observations, () => 0);
  assert.equal(Math.abs(p.x - 8) + Math.abs(p.y - 8), 1);
});

test('all difficulties avoid revealed cells of a destroyed plane', () => {
  const destroyed = planeCells({ id: 'dead', head: { x: 4, y: 3 }, direction: 'UP', destroyed: true });
  const observations: AiObservation[] = [
    { position: { x: 4, y: 3 }, kind: 'DESTROYED', revealedCells: destroyed },
  ];
  const revealed = new Set(destroyed.map((cell) => key(cell.position)));
  for (const difficulty of ['EASY', 'NORMAL', 'HARD'] as const) {
    for (let sample = 0; sample < 100; sample += 1) {
      assert.equal(revealed.has(key(chooseAiAttack(difficulty, observations, () => sample / 100))), false);
    }
  }
});
