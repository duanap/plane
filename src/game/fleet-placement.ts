import { planeCells, validatePlacement } from './geometry.ts';
import type { Direction, Plane, Position } from './types.ts';

export const directionLabel: Record<Direction, string> = { UP: '↑', RIGHT: '→', DOWN: '↓', LEFT: '←' };
const directions: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

export function defaultFleet(prefix = 'p'): Plane[] {
  return [
    { id: `${prefix}1`, head: { x: 2, y: 1 }, direction: 'UP', destroyed: false },
    { id: `${prefix}2`, head: { x: 7, y: 1 }, direction: 'UP', destroyed: false },
    { id: `${prefix}3`, head: { x: 4, y: 8 }, direction: 'DOWN', destroyed: false },
  ];
}

export type FleetEdit = { valid: true; fleet: Plane[] } | { valid: false; reason: 'OUT_OF_BOUNDS' | 'UNKNOWN_PLANE' };

export function overlapPositions(fleet: Plane[]): Position[] {
  const occupied = new Map<string, { position: Position; count: number }>();
  for (const plane of fleet) for (const { position } of planeCells(plane)) {
    const key = `${position.x}:${position.y}`;
    const existing = occupied.get(key);
    if (existing) existing.count++;
    else occupied.set(key, { position, count: 1 });
  }
  return [...occupied.values()].filter((cell) => cell.count > 1).map((cell) => cell.position);
}

export function movePlane(fleet: Plane[], id: string, head: Position): FleetEdit {
  const plane = fleet.find((item) => item.id === id);
  if (!plane) return { valid: false, reason: 'UNKNOWN_PLANE' };
  if (!Number.isInteger(head.x) || !Number.isInteger(head.y)) return { valid: false, reason: 'OUT_OF_BOUNDS' };
  return replacePlane(fleet, { ...plane, head: { ...head } });
}

function replacePlane(fleet: Plane[], plane: Plane): FleetEdit {
  const next = fleet.map((item) => item.id === plane.id ? plane : item);
  // Draft edits may overlap; the complete fleet is validated only when confirming.
  return validatePlacement([plane]).valid ? { valid: true, fleet: next } : { valid: false, reason: 'OUT_OF_BOUNDS' };
}

export function rotatePlane(fleet: Plane[], id: string): FleetEdit {
  const plane = fleet.find((item) => item.id === id);
  if (!plane) return { valid: false, reason: 'UNKNOWN_PLANE' };
  const next: Plane = { ...plane, head: { ...plane.head }, direction: directions[(directions.indexOf(plane.direction) + 1) % 4] };
  // Keep the head as the pivot; move inward only when the rotated footprint crosses an edge.
  const cells = planeCells(next).map((cell) => cell.position);
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  next.head.x += Math.max(0, -Math.min(...xs)) - Math.max(0, Math.max(...xs) - 9);
  next.head.y += Math.max(0, -Math.min(...ys)) - Math.max(0, Math.max(...ys) - 9);
  return replacePlane(fleet, next);
}

export function gridPosition(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }): Position {
  return { x: Math.floor((clientX - bounds.left) / bounds.width * 10), y: Math.floor((clientY - bounds.top) / bounds.height * 10) };
}

export function draggedHead(head: Position, start: Position, end: Position): Position {
  return { x: head.x + end.x - start.x, y: head.y + end.y - start.y };
}
