import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Direction, Plane, Position } from '../game/types.ts';

export type PlacementCandidate =
  | { fleet: Plane[]; valid: true }
  | { fleet: Plane[]; valid: false; reason: 'OUT_OF_BOUNDS' | 'OVERLAP' };

const DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

function clonePlane(plane: Plane): Plane {
  return { ...plane, head: { ...plane.head } };
}

function cloneFleet(fleet: Plane[]): Plane[] {
  return fleet.map(clonePlane);
}

export function createPlacementFleet(prefix = 'p', random = Math.random): Plane[] {
  return randomFleet(prefix, random);
}

export function planeAt(fleet: Plane[], position: Position): Plane | undefined {
  return fleet.find((plane) => planeCells(plane).some(
    (cell) => cell.position.x === position.x && cell.position.y === position.y,
  ));
}

export function dragCandidate(
  fleet: Plane[],
  planeId: string,
  grabbedPosition: Position,
  pointerPosition: Position,
): PlacementCandidate {
  const source = fleet.find((plane) => plane.id === planeId);
  if (!source) throw new Error(`Unknown plane: ${planeId}`);

  const offset = {
    x: grabbedPosition.x - source.head.x,
    y: grabbedPosition.y - source.head.y,
  };
  const candidateFleet = cloneFleet(fleet).map((plane) => plane.id === planeId
    ? {
        ...plane,
        head: {
          x: pointerPosition.x - offset.x,
          y: pointerPosition.y - offset.y,
        },
      }
    : plane);
  const validation = validatePlacement(candidateFleet);
  return validation.valid
    ? { fleet: candidateFleet, valid: true }
    : { fleet: candidateFleet, valid: false, reason: validation.reason };
}

export function rotateCandidate(fleet: Plane[], planeId: string): PlacementCandidate {
  const source = fleet.find((plane) => plane.id === planeId);
  if (!source) throw new Error(`Unknown plane: ${planeId}`);

  const direction = DIRECTIONS[(DIRECTIONS.indexOf(source.direction) + 1) % DIRECTIONS.length];
  const candidateFleet = cloneFleet(fleet).map((plane) => plane.id === planeId
    ? { ...plane, direction }
    : plane);
  const validation = validatePlacement(candidateFleet);
  return validation.valid
    ? { fleet: candidateFleet, valid: true }
    : { fleet: cloneFleet(fleet), valid: false, reason: validation.reason };
}
