import type { PublicAttackRecord, PublicRoomView } from './room-store.ts';

export interface AttackFrame {
  key: string;
  attack: PublicAttackRecord;
  view: PublicRoomView;
}

/** Keeps each arriving attack visible before presenting the next turn or final result. */
export class AttackPlayback {
  latest: PublicRoomView | null = null;
  private frames: AttackFrame[] = [];

  get result(): AttackFrame | null { return this.frames[0] ?? null; }
  get visibleView(): PublicRoomView | null { return this.result?.view ?? this.latest; }

  reset(): void { this.latest = null; this.frames = []; }

  update(next: PublicRoomView): boolean {
    const previous = this.latest;
    if (previous?.roomId === next.roomId
      && ((next.status === 'WAITING' && previous.status !== 'WAITING')
        || (next.status === 'PLACEMENT' && previous.status === 'PLAYING'))) return false;
    if (!previous || previous.roomId !== next.roomId || next.status === 'WAITING' || next.status === 'PLACEMENT') {
      this.reset();
      this.latest = next;
      return true;
    }
    // HTTP replies and SSE can arrive in either order. Never replay an older attack.
    if (next.attacks.length < previous.attacks.length
      || (previous.status === 'FINISHED' && next.status === 'PLAYING')) return false;
    if (next.attacks.length > previous.attacks.length) {
      // A reconnect may skip multiple attacks; show the latest one rather than replay old history.
      const index = next.attacks.length - 1;
      this.frames.push({ key: `${next.roomId}:${index}`, attack: next.attacks[index], view: next });
    }
    this.latest = next;
    return true;
  }

  advance(key: string): boolean {
    if (this.result?.key !== key) return false;
    this.frames.shift();
    return true;
  }
}
