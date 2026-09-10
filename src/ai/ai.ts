import { BOARD_SIZE, planeCells, validatePlacement } from '../game/geometry.ts';
import type { Direction, Plane, PlaneCell, Position } from '../game/types.ts';

export type AiDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface AiObservation {
  position: Position;
  kind: 'MISS' | 'HIT' | 'DESTROYED';
  revealedCells?: PlaneCell[];
}

export interface AiPlaneCandidate {
  head: Position;
  direction: Direction;
  cells: PlaneCell[];
}

const DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

function key(position: Position): string {
  return `${position.x}:${position.y}`;
}

function allCoordinates(): Position[] {
  const result: Position[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) result.push({ x, y });
  }
  return result;
}

export function enumeratePlaneCandidates(): AiPlaneCandidate[] {
  const candidates: AiPlaneCandidate[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      for (const direction of DIRECTIONS) {
        const plane: Plane = { id: 'candidate', head: { x, y }, direction, destroyed: false };
        if (!validatePlacement([plane]).valid) continue;
        candidates.push({ head: { x, y }, direction, cells: planeCells(plane) });
      }
    }
  }
  return candidates;
}

function chooseByIndex<T>(items: T[], random: () => number): T {
  if (items.length === 0) throw new Error('No AI attack coordinates remain.');
  const sample = Math.max(0, Math.min(0.999999999, random()));
  return items[Math.floor(sample * items.length)];
}

function untriedCoordinates(observations: AiObservation[]): Position[] {
  const attacked = new Set(observations.map((observation) => key(observation.position)));
  return allCoordinates().filter((position) => !attacked.has(key(position)));
}

function easyAttack(observations: AiObservation[], random: () => number): Position {
  return chooseByIndex(untriedCoordinates(observations), random);
}

function normalAttack(observations: AiObservation[], random: () => number): Position {
  const available = untriedCoordinates(observations);
  const unresolvedHits = observations.filter((observation) => observation.kind === 'HIT').map((observation) => observation.position);
  if (unresolvedHits.length === 0) return chooseByIndex(available, random);

  let bestDistance = Number.POSITIVE_INFINITY;
  const scored: Position[] = [];
  for (const position of available) {
    const distance = Math.min(...unresolvedHits.map((hit) => Math.abs(position.x - hit.x) + Math.abs(position.y - hit.y)));
    if (distance < bestDistance) {
      bestDistance = distance;
      scored.length = 0;
      scored.push(position);
    } else if (distance === bestDistance) {
      scored.push(position);
    }
  }
  return chooseByIndex(scored, random);
}

function hardAttack(observations: AiObservation[], random: () => number): Position {
  const attacked = new Set(observations.map((observation) => key(observation.position)));
  const misses = new Set(observations.filter((observation) => observation.kind === 'MISS').map((observation) => key(observation.position)));
  const unresolvedHits = new Set(observations.filter((observation) => observation.kind === 'HIT').map((observation) => key(observation.position)));
  const resolved = new Set<string>();
  for (const observation of observations) {
    if (observation.kind !== 'DESTROYED') continue;
    for (const cell of observation.revealedCells ?? []) resolved.add(key(cell.position));
  }

  const scores = new Map<string, { position: Position; score: number }>();
  for (const candidate of enumeratePlaneCandidates()) {
    const candidateKeys = new Set(candidate.cells.map((cell) => key(cell.position)));
    if ([...misses].some((miss) => candidateKeys.has(miss))) continue;
    if ([...resolved].some((cell) => candidateKeys.has(cell))) continue;

    let coveredHits = 0;
    for (const hit of unresolvedHits) if (candidateKeys.has(hit)) coveredHits += 1;
    const evidenceWeight = Math.pow(6, coveredHits);

    for (const cell of candidate.cells) {
      const cellKey = key(cell.position);
      if (attacked.has(cellKey)) continue;
      const tacticalWeight = cell.kind === 'HEAD' ? 8 : 1;
      const current = scores.get(cellKey);
      const score = (current?.score ?? 0) + tacticalWeight * evidenceWeight;
      scores.set(cellKey, { position: cell.position, score });
    }
  }

  if (scores.size === 0) return easyAttack(observations, random);
  const maxScore = Math.max(...[...scores.values()].map((entry) => entry.score));
  const best = [...scores.values()].filter((entry) => entry.score === maxScore).map((entry) => entry.position);
  return chooseByIndex(best, random);
}

export function chooseAiAttack(
  difficulty: AiDifficulty,
  observations: AiObservation[],
  random: () => number = Math.random,
): Position {
  if (difficulty === 'EASY') return easyAttack(observations, random);
  if (difficulty === 'NORMAL') return normalAttack(observations, random);
  return hardAttack(observations, random);
}
