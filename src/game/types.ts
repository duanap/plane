export type Direction = 'UP' | 'RIGHT' | 'DOWN' | 'LEFT';

export interface Position {
  x: number;
  y: number;
}

export interface Plane {
  id: string;
  head: Position;
  direction: Direction;
  destroyed: boolean;
}

export type PlaneCellKind = 'HEAD' | 'BODY';

export interface PlaneCell {
  planeId: string;
  kind: PlaneCellKind;
  position: Position;
}

export type PlacementValidation =
  | { valid: true }
  | { valid: false; reason: 'OUT_OF_BOUNDS' | 'OVERLAP' };
