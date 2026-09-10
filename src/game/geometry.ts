import type { Direction, Plane, PlaneCell, PlacementValidation, Position } from './types.ts';

export const BOARD_SIZE = 10;

const BASE_OFFSETS: Array<{ x: number; y: number; kind: 'HEAD' | 'BODY' }> = [
  { x: 0, y: 0, kind: 'HEAD' },
  { x: -2, y: 1, kind: 'BODY' },
  { x: -1, y: 1, kind: 'BODY' },
  { x: 0, y: 1, kind: 'BODY' },
  { x: 1, y: 1, kind: 'BODY' },
  { x: 2, y: 1, kind: 'BODY' },
  { x: 0, y: 2, kind: 'BODY' },
  { x: -1, y: 3, kind: 'BODY' },
  { x: 0, y: 3, kind: 'BODY' },
  { x: 1, y: 3, kind: 'BODY' },
];

function rotateOffset(position: Position, direction: Direction): Position {
  switch (direction) {
    case 'UP':
      return position;
    case 'RIGHT':
      return { x: -position.y, y: position.x };
    case 'DOWN':
      return { x: -position.x, y: -position.y };
    case 'LEFT':
      return { x: position.y, y: -position.x };
  }
}

export function planeCells(plane: Plane): PlaneCell[] {
  return BASE_OFFSETS.map((cell) => {
    const rotated = rotateOffset(cell, plane.direction);
    return {
      planeId: plane.id,
      kind: cell.kind,
      position: {
        x: plane.head.x + rotated.x,
        y: plane.head.y + rotated.y,
      },
    };
  });
}

export function isInsideBoard(position: Position): boolean {
  return position.x >= 0 && position.x < BOARD_SIZE && position.y >= 0 && position.y < BOARD_SIZE;
}

function coordinateKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

export function validatePlacement(planes: Plane[]): PlacementValidation {
  const occupied = new Set<string>();

  for (const plane of planes) {
    for (const cell of planeCells(plane)) {
      if (!isInsideBoard(cell.position)) {
        return { valid: false, reason: 'OUT_OF_BOUNDS' };
      }

      const key = coordinateKey(cell.position);
      if (occupied.has(key)) {
        return { valid: false, reason: 'OVERLAP' };
      }
      occupied.add(key);
    }
  }

  return { valid: true };
}

const DIRECTIONS: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export function randomFleet(prefix = 'p', random = Math.random): Plane[] {
  const planes: Plane[] = [];
  let attempts = 0;

  while (planes.length < 3 && attempts < 5000) {
    attempts += 1;
    const candidate: Plane = {
      id: `${prefix}${planes.length + 1}`,
      head: {
        x: Math.floor(random() * BOARD_SIZE),
        y: Math.floor(random() * BOARD_SIZE),
      },
      direction: DIRECTIONS[Math.floor(random() * DIRECTIONS.length)],
      destroyed: false,
    };
    if (validatePlacement([...planes, candidate]).valid) {
      planes.push(candidate);
    }
  }

  if (planes.length !== 3) {
    throw new Error('Unable to generate a legal fleet.');
  }

  return planes;
}
