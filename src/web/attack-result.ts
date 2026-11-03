import type { AttackRecord } from '../game/game.ts';
import { coordLabel } from '../online/client-model.ts';

export const ATTACK_RESULT_DURATION_MS = 1800;
export type AttackFeedback = Pick<AttackRecord, 'attackerId' | 'position' | 'kind'>;
const labels = { MISS: '未命中', HIT: '命中机身', DESTROYED: '击落战机' };
const symbols = { MISS: '○', HIT: '×', DESTROYED: '✹' };

function resultLabel(attack: AttackFeedback, revealOutline: boolean): string {
  return attack.kind === 'DESTROYED' && !revealOutline ? '击中机头' : labels[attack.kind];
}

export function attackMessage(attack: AttackFeedback, revealOutline = true): string {
  return `${coordLabel(attack.position)}：${resultLabel(attack, revealOutline)}。`;
}

export function attackResultHtml(attack: AttackFeedback, next: string, revealOutline = true): string {
  return `<div class="attack-feedback result-${attack.kind.toLowerCase()}${attack.position.y >= 6 ? ' feedback-top' : ''}" role="status" aria-live="assertive"><span class="attack-symbol" aria-hidden="true">${symbols[attack.kind]}</span><div><strong>${coordLabel(attack.position)} · ${resultLabel(attack, revealOutline)}</strong><span>${next}</span></div></div>`;
}

/** Repeated renders and duplicate events must not extend the result display. */
export class AttackResultDelay {
  private key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(key: string | null, complete: () => void): void {
    if (key === this.key) return;
    this.clear();
    this.key = key;
    if (key !== null) this.timer = setTimeout(() => {
      this.timer = null;
      this.key = null;
      complete();
    }, ATTACK_RESULT_DURATION_MS);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.key = null;
  }
}
