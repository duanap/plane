import type { Position } from '../game/types.ts';
import type { PublicRoomView } from './room-store.ts';

export type BoardPerspective = 'ENEMY' | 'OWN';

export { normalizeRoomCode, isRoomCode } from './room-code.ts';

export function coordLabel(position: Position): string {
  return `${String.fromCharCode(65 + position.y)}${position.x + 1}`;
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

export function canAttackCell(view: PublicRoomView, position: Position): boolean {
  if (view.status !== 'PLAYING' || view.currentPlayerId !== view.playerId) return false;
  return !view.attacks.some(
    (record) => record.attackerId === view.playerId && samePosition(record.position, position),
  );
}

export function attackClassFor(
  view: PublicRoomView,
  perspective: BoardPerspective,
  position: Position,
): 'miss' | 'hit' | 'destroyed' | undefined {
  const record = view.attacks.find((attack) => {
    const relevant = perspective === 'ENEMY'
      ? attack.attackerId === view.playerId
      : attack.targetId === view.playerId;
    return relevant && samePosition(attack.position, position);
  });
  if (!record) return undefined;
  if (record.kind === 'MISS') return 'miss';
  if (record.kind === 'HIT') return 'hit';
  return 'destroyed';
}

export function revealedCellKindFor(
  view: PublicRoomView,
  perspective: BoardPerspective,
  position: Position,
): 'HEAD' | 'BODY' | undefined {
  if (perspective !== 'ENEMY') return undefined;
  for (const plane of view.opponentRevealedPlanes) {
    const cell = plane.cells.find((candidate) => samePosition(candidate.position, position));
    if (cell) return cell.kind;
  }
  return undefined;
}
