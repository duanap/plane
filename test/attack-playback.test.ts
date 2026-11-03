import test from 'node:test';
import assert from 'node:assert/strict';
import { AttackPlayback } from '../src/online/attack-playback.ts';
import { AttackResultDelay, ATTACK_RESULT_DURATION_MS, attackMessage, attackResultHtml } from '../src/web/attack-result.ts';
import type { PublicAttackRecord, PublicRoomView } from '../src/online/room-store.ts';

const first: PublicAttackRecord = { attackerId: 'A', targetId: 'B', position: { x: 0, y: 9 }, kind: 'MISS' };
const second: PublicAttackRecord = { attackerId: 'B', targetId: 'A', position: { x: 2, y: 1 }, kind: 'DESTROYED' };
test('head-only feedback keeps the coordinate and head-impact message', () => {
  assert.equal(attackMessage(second, false), 'B3：击中机头。');
  assert.match(attackResultHtml(second, '即将进入对手回合', false), /B3 · 击中机头/);
  assert.match(attackResultHtml(second, '即将进入对手回合', true), /击落战机/);
});
function view(attacks: PublicAttackRecord[] = [], status: PublicRoomView['status'] = 'PLAYING'): PublicRoomView {
  return { roomId: '012345', settings: { revealDestroyedPlanes: false }, playerId: 'A', status, currentPlayerId: attacks.length % 2 === 0 ? 'A' : 'B',
    players: { A: { joined: true, ready: true, connected: true }, B: { joined: true, ready: true, connected: true } },
    attacks, destroyedCounts: { A: 0, B: 0 }, opponentRevealedPlanes: [], rematchVotes: { A: false, B: false } };
}

test('refreshing a game does not replay historical attacks', () => {
  const playback = new AttackPlayback();
  const restored = view([first, second]);
  playback.update(restored);
  assert.equal(playback.result, null);
  assert.equal(playback.visibleView, restored);
});

test('miss, hit and destroyed feedback remain available before the next turn or settlement', () => {
  for (const kind of ['MISS', 'HIT', 'DESTROYED'] as const) {
    const playback = new AttackPlayback();
    playback.update(view());
    const next = view([{ ...first, kind }], kind === 'DESTROYED' ? 'FINISHED' : 'PLAYING');
    playback.update(next);
    assert.equal(playback.result?.attack.kind, kind);
    assert.equal(playback.visibleView, next);
    assert.equal(playback.advance(playback.result!.key), true);
    assert.equal(playback.result, null);
    assert.equal(playback.visibleView, next);
  }
});

test('HTTP and SSE duplicates cannot replay feedback after it has completed', () => {
  for (const order of [['HTTP', 'SSE'], ['SSE', 'HTTP']]) {
    const playback = new AttackPlayback();
    playback.update(view());
    const next = view([first]);
    playback.update(next);
    const key = playback.result!.key;
    playback.update(structuredClone(next));
    assert.equal(playback.result!.key, key, order.join(' then '));
    playback.advance(key);
    playback.update(structuredClone(next));
    assert.equal(playback.result, null);
  }
});

test('a second incoming attack waits until the first result is shown', () => {
  const playback = new AttackPlayback();
  playback.update(view());
  const a = view([first]);
  const b = view([first, second]);
  playback.update(a);
  const firstKey = playback.result!.key;
  playback.update(b);
  assert.equal(playback.visibleView, a);
  assert.equal(playback.result?.attack.attackerId, 'A');
  playback.advance(firstKey);
  assert.equal(playback.visibleView, b);
  assert.equal(playback.result?.attack.attackerId, 'B');
  assert.equal(playback.advance(firstKey), false, 'an expired callback must not dismiss the next result');
  playback.advance(playback.result!.key);
  assert.equal(playback.result, null);
  assert.equal(playback.visibleView?.currentPlayerId, 'A');
});

test('an old HTTP reply cannot roll back a newer SSE update', () => {
  const playback = new AttackPlayback();
  playback.update(view());
  playback.update(view([first]));
  const latest = view([first, second]);
  playback.update(latest);
  assert.equal(playback.update(view([first])), false);
  assert.equal(playback.latest, latest);
  assert.equal(playback.update(view([], 'PLACEMENT')), false);
  assert.equal(playback.latest, latest);
});

test('reconnect gaps show only the latest missed attack', () => {
  const playback = new AttackPlayback();
  playback.update(view());
  playback.update(view([first, second]));
  assert.equal(playback.result?.attack, second);
  playback.advance(playback.result!.key);
  assert.equal(playback.result, null);
});

test('rematches and switching rooms clear pending feedback', () => {
  const playback = new AttackPlayback();
  playback.update(view());
  playback.update(view([first], 'FINISHED'));
  playback.update(view([], 'PLACEMENT'));
  assert.equal(playback.result, null);
  playback.update(view());
  playback.update(view([first]));
  playback.update({ ...view(), roomId: '654321' });
  assert.equal(playback.result, null);
  playback.reset();
  assert.equal(playback.visibleView, null);
});

test('result delay holds the full duration and duplicate renders do not extend it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delay = new AttackResultDelay();
  let completed = 0;
  delay.show('attack-1', () => completed++);
  t.mock.timers.tick(ATTACK_RESULT_DURATION_MS - 1);
  assert.equal(completed, 0);
  delay.show('attack-1', () => { throw new Error('duplicate render reset the timer'); });
  t.mock.timers.tick(1);
  assert.equal(completed, 1);
  t.mock.timers.tick(ATTACK_RESULT_DURATION_MS);
  assert.equal(completed, 1);
});

test('clearing a result or starting a new result cancels the old timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delay = new AttackResultDelay();
  let completed = '';
  delay.show('old', () => { completed = 'old'; });
  t.mock.timers.tick(100);
  delay.show('new', () => { completed = 'new'; });
  t.mock.timers.tick(ATTACK_RESULT_DURATION_MS - 1);
  assert.equal(completed, '');
  t.mock.timers.tick(1);
  assert.equal(completed, 'new');
  delay.show('cancelled', () => { completed = 'cancelled'; });
  delay.clear();
  t.mock.timers.tick(ATTACK_RESULT_DURATION_MS);
  assert.equal(completed, 'new');
});
