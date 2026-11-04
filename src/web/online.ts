import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Plane, Position } from '../game/types.ts';
import { attackClassFor, canAttackCell, coordLabel, isRoomCode, normalizeRoomCode, revealedCellKindFor, type BoardPerspective } from '../online/client-model.ts';
import type { PlayerId, PublicRoomView, RoomIdentity } from '../online/room-store.ts';
import { defaultFleet } from '../game/fleet-placement.ts';
import { bindFleetEditor, fleetBoard, fleetTools } from './fleet-editor.ts';
import { boardFrame } from './board.ts';
import { AttackPlayback } from '../online/attack-playback.ts';
import { AttackResultDelay, attackMessage, attackResultHtml } from './attack-result.ts';
import { actionLabel, lobbyArt, uiIcon } from './neon-ui.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

const STORAGE_KEY = 'plane-online-identity';
const invitedRoom = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
let lobbyScreen: 'CHOICE' | 'JOIN' = isRoomCode(invitedRoom) ? 'JOIN' : 'CHOICE';
let joinDraft = isRoomCode(invitedRoom) ? invitedRoom : '';
let lobbyBusy = false;
let revealDestroyedPlanes = false;

let identity: RoomIdentity | null = loadIdentity();
let view: PublicRoomView | null = null;
let eventSource: EventSource | null = null;
let localFleet: Plane[] = [];
let selectedPlaneId = '';
let placementHistory: Plane[][] = [];
let placementGesture = false;
let submitting = false;
let attackPending = false;
let selectedTarget: Position | null = null;
let activeBoard: BoardPerspective = 'ENEMY';
let message = '';
const playback = new AttackPlayback();
const resultDelay = new AttackResultDelay();

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}

function loadIdentity(): RoomIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomIdentity>;
    if (!parsed.roomId || !isRoomCode(parsed.roomId) || (parsed.playerId !== 'A' && parsed.playerId !== 'B') || typeof parsed.token !== 'string') return null;
    if (invitedRoom && normalizeRoomCode(parsed.roomId) !== invitedRoom) return null;
    return { roomId: normalizeRoomCode(parsed.roomId), playerId: parsed.playerId, token: parsed.token };
  } catch {
    return null;
  }
}

function saveIdentity(next: RoomIdentity): void {
  identity = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  history.replaceState(null, '', `/online.html?room=${encodeURIComponent(next.roomId)}`);
}

function leaveRoom(): void {
  resultDelay.clear();
  playback.reset();
  eventSource?.close();
  eventSource = null;
  identity = null;
  view = null;
  localFleet = [];
  placementHistory = [];
  submitting = false;
  selectedTarget = null;
  lobbyScreen = 'CHOICE';
  joinDraft = '';
  revealDestroyedPlanes = false;
  localStorage.removeItem(STORAGE_KEY);
  history.replaceState(null, '', '/online.html');
  message = '';
  render();
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json() as { ok: boolean; error?: { code: string; message: string } } & T;
  if (!response.ok || !body.ok) throw new Error(body.error?.message ?? '请求失败');
  return body;
}

function applyView(next: PublicRoomView): void {
  if (!identity || next.roomId !== identity.roomId) return;
  const previous = playback.latest;
  if (!playback.update(next)) return;
  const enteringPlacement = next.status === 'PLACEMENT' && previous?.status !== 'PLACEMENT';
  const enteringBattle = next.status === 'PLAYING' && previous?.status !== 'PLAYING';
  const enteringFinished = Boolean(previous && previous.status !== 'FINISHED' && next.status === 'FINISHED');
  if (enteringPlacement) {
    localFleet = next.ownFleet?.map((plane) => ({ ...plane, head: { ...plane.head } })) ?? defaultFleet(next.playerId.toLowerCase());
    selectedPlaneId = localFleet[0].id;
    placementHistory = [];
    selectedTarget = null;
    message = next.players[next.playerId].ready ? '布局已锁定，等待对手准备。' : '已摆好 3 架飞机，拖动调整位置，点击飞机旋转。';
  }
  if (enteringFinished) {
    activeBoard = 'ENEMY';
    selectedTarget = null;
  }
  if (enteringBattle) {
    activeBoard = 'ENEMY';
    selectedTarget = null;
    message = next.currentPlayerId === next.playerId ? '轮到你了，选择一个坐标并确认攻击。' : '对手正在行动，请稍候。';
  }
  syncAttackPlayback();
  render();
}

function syncAttackPlayback(): void {
  view = playback.visibleView;
  const frame = playback.result;
  if (frame && identity) {
    activeBoard = frame.attack.attackerId === identity.playerId ? 'ENEMY' : 'OWN';
    selectedTarget = null;
    message = attackMessage(frame.attack, view?.settings?.revealDestroyedPlanes ?? false);
  }
  resultDelay.show(frame?.key ?? null, () => {
    if (!frame || !playback.advance(frame.key)) return;
    syncAttackPlayback();
    if (!playback.result && view && identity && view.status === 'PLAYING') {
      const myTurn = view.currentPlayerId === identity.playerId;
      if (myTurn) activeBoard = 'ENEMY';
      message = myTurn ? '轮到你了，选择一个坐标并确认攻击。' : '对手正在行动，请稍候。';
    }
    render();
  });
}

async function refreshState(): Promise<void> {
  if (!identity) return;
  const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity.roomId}/state?token=${encodeURIComponent(identity.token)}`);
  applyView(body.view);
}

function openEvents(): void {
  if (!identity) return;
  eventSource?.close();
  eventSource = new EventSource(`/api/rooms/${identity.roomId}/events?token=${encodeURIComponent(identity.token)}`);
  eventSource.addEventListener('state', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as { ok: true; view: PublicRoomView };
    if (message.startsWith('连接暂时中断')) message = '已重新连接。';
    applyView(payload.view);
  });
  eventSource.onerror = () => {
    message = '连接暂时中断，正在自动重连…';
    render();
  };
}

async function connectIdentity(): Promise<void> {
  if (!identity) return;
  try {
    await refreshState();
    openEvents();
  } catch (error) {
    resultDelay.clear();
    playback.reset();
    message = error instanceof Error ? error.message : '无法恢复房间';
    localStorage.removeItem(STORAGE_KEY);
    identity = null;
    view = null;
    render();
  }
}

function button(label: string, id: string, className = 'action', disabled = false, type: 'button' | 'submit' = 'button'): string {
  return `<button type="${type}" class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${actionLabel(escapeHtml(label), id)}</button>`;
}

function shell(content: string, badge = '在线对战', layoutClass = ''): string {
  return `<div class="shell play-shell ${layoutClass}"><header class="topbar"><div class="brand"><h1>${uiIcon('plane')}炸飞机 <small>PLANE</small></h1><p>在线对战 · 各自布阵，实时交锋</p></div><div class="top-actions"><span class="badge">${escapeHtml(badge)}</span><a class="text-link" href="/">返回首页</a></div></header>${content}</div>`;
}

function posKey(position: Position): string { return `${position.x}:${position.y}`; }

function ownCellMap(fleet: Plane[] | undefined): Map<string, { kind: 'HEAD' | 'BODY'; destroyed: boolean }> {
  const map = new Map<string, { kind: 'HEAD' | 'BODY'; destroyed: boolean }>();
  for (const plane of fleet ?? []) {
    for (const cell of planeCells(plane)) map.set(posKey(cell.position), { kind: cell.kind, destroyed: plane.destroyed });
  }
  return map;
}

function boardHtml(perspective: BoardPerspective, interactive: boolean, fleet = view?.ownFleet): string {
  if (!view) return '';
  const own = perspective === 'OWN' ? ownCellMap(fleet) : new Map<string, { kind: 'HEAD' | 'BODY'; destroyed: boolean }>();
  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const key = posKey(position);
      const classes = ['cell'];
      const ownCell = own.get(key);
      const attackClass = attackClassFor(view, perspective, position);
      const hideFinalOutline = playback.result && !view.settings?.revealDestroyedPlanes && view.status === 'FINISHED';
      const revealedKind = hideFinalOutline ? undefined : revealedCellKindFor(view, perspective, position);
      if (ownCell) classes.push('plane', ownCell.kind === 'HEAD' ? 'head' : 'body');
      if (ownCell?.destroyed) classes.push('revealed');
      if (attackClass) classes.push(attackClass);
      if (revealedKind) classes.push('revealed', revealedKind === 'HEAD' ? 'revealed-head' : 'revealed-body');
      if (perspective === 'ENEMY' && selectedTarget && posKey(selectedTarget) === key) classes.push('selected');
      const result = playback.result?.attack;
      if (result && posKey(result.position) === key) classes.push('last-attack');
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coordLabel(position)}" aria-label="${coordLabel(position)}" ${interactive ? '' : 'tabindex="-1"'}></button>`;
    }
  }
  const result = playback.result?.attack;
  const next = view.status === 'FINISHED' ? '即将显示对局结果' : view.currentPlayerId === identity?.playerId ? '即将轮到你攻击' : '即将进入对手回合';
  return boardFrame(html + '</div>', result ? attackResultHtml(result, next, view.settings?.revealDestroyedPlanes ?? false) : '');
}

function connectionLabel(playerId: PlayerId): string {
  if (!view) return '';
  const player = view.players[playerId];
  if (!player.joined) return '等待加入';
  return player.connected ? '在线' : '离线/重连中';
}

function inviteUrl(): string {
  return identity ? `${location.origin}/online.html?room=${identity.roomId}` : location.href;
}

function roomRuleHtml(): string {
  return `<p class="room-rule">机头命中后：${view?.settings?.revealDestroyedPlanes ? '显示完整机身轮廓' : '仅保留机头标记'}</p>`;
}

function renderLanding(): void {
  if (lobbyScreen === 'JOIN') return renderJoin();
  app.innerHTML = shell(`<section class="online-home lobby-home">
    <div class="online-hero lobby-hero"><h2>在线双人对战</h2><p class="subtle">创建一场对决，或加入朋友的房间。</p><div class="lobby-tags"><span>${uiIcon('people')}双人对战</span><span>${uiIcon('bolt')}实时对战</span><span>${uiIcon('shield')}好友同玩</span></div></div>
    <div class="lobby-panel">
    <div class="lobby-choice-grid">
      <section class="lobby-choice create-choice"><span class="lobby-card-tag">＋ 新建对局</span>${lobbyArt('plane')}<h3>创建房间</h3><p>生成专属的 6 位数字房间号，<br />邀请朋友加入。</p><label class="room-setting"><input id="reveal-outline" type="checkbox" ${revealDestroyedPlanes ? 'checked' : ''} ${lobbyBusy ? 'disabled' : ''} /><span>击中机头后显示完整轮廓<small>默认关闭，仅保留机头标记</small></span></label>${button(lobbyBusy ? '正在创建…' : '创建房间', 'create-room', 'action primary', lobbyBusy)}</section>
      <section class="lobby-choice join-choice"><span class="lobby-card-tag">→ 加入对局</span>${lobbyArt('radar')}<h3>加入房间</h3><p>已经有房间号？<br />输入朋友分享的 6 位房间号即可加入。</p><label class="lobby-code-label" for="lobby-room-code"><span aria-hidden="true">#</span><input id="lobby-room-code" class="room-input" type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="off" aria-label="大厅房间号" placeholder="请输入 6 位房间号" value="${escapeHtml(joinDraft)}" ${lobbyBusy ? 'disabled' : ''} /></label>${button('加入房间', 'open-join', 'action', lobbyBusy)}</section>
    </div>
    ${message ? `<div class="notice error" role="alert">${escapeHtml(message)}</div>` : ''}
    <a class="action-link lobby-local-link" href="/local.html">${uiIcon('people')}切换到本地双人 ${uiIcon('arrow')}</a></div>
  </section>`, '在线对战', 'lobby-shell');

  document.querySelector<HTMLInputElement>('#reveal-outline')?.addEventListener('change', (event) => {
    revealDestroyedPlanes = (event.target as HTMLInputElement).checked;
  });
  document.querySelector('#open-join')?.addEventListener('click', () => {
    lobbyScreen = 'JOIN'; message = ''; render();
    document.querySelector<HTMLInputElement>('#room-code')?.focus();
  });
  document.querySelector<HTMLInputElement>('#lobby-room-code')?.addEventListener('input', (event) => {
    joinDraft = (event.target as HTMLInputElement).value;
  });
  document.querySelector('#lobby-room-code')?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); document.querySelector<HTMLButtonElement>('#open-join')?.click(); }
  });
  document.querySelector('#create-room')?.addEventListener('click', async () => {
    if (lobbyBusy) return;
    revealDestroyedPlanes = document.querySelector<HTMLInputElement>('#reveal-outline')?.checked ?? false;
    lobbyBusy = true;
    message = '';
    render();
    try {
      const body = await api<{ identity: RoomIdentity }>('/api/rooms', { method: 'POST', body: JSON.stringify({ settings: { revealDestroyedPlanes } }) });
      saveIdentity(body.identity);
      message = '房间已创建，等待另一名玩家加入。';
      await connectIdentity();
    } catch (error) { message = error instanceof Error ? error.message : '创建失败'; }
    finally { lobbyBusy = false; render(); }
  });
}

function renderJoin(): void {
  app.innerHTML = shell(`<section class="panel online-home join-home">
    <div class="online-hero"><h2>加入房间</h2><p class="subtle">输入朋友分享的 6 位数字房间号。</p></div>
    <form class="join-form" id="join-form" novalidate>
      <label for="room-code">房间号</label>
      <input id="room-code" name="room-code" class="room-input" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off" placeholder="6 位数字房间号" value="${escapeHtml(joinDraft)}" aria-describedby="room-code-help${message ? ' join-error' : ''}" ${message ? 'aria-invalid="true"' : ''} ${lobbyBusy ? 'disabled' : ''} />
      <p id="room-code-help" class="join-help">请保留开头的 0，完整输入 6 位数字。</p>
      ${message ? `<div class="notice error" id="join-error" role="alert">${escapeHtml(message)}</div>` : ''}
      ${button(lobbyBusy ? '正在加入…' : '确认加入', 'join-room', 'action primary', lobbyBusy, 'submit')}
      ${button('返回在线大厅', 'back-lobby', 'action lobby-back', lobbyBusy)}
    </form>
  </section>`, '加入房间', 'lobby-shell join-shell');

  document.querySelector<HTMLInputElement>('#room-code')?.addEventListener('input', (event) => {
    joinDraft = (event.target as HTMLInputElement).value;
  });
  document.querySelector('#back-lobby')?.addEventListener('click', () => { lobbyScreen = 'CHOICE'; message = ''; render(); });
  document.querySelector('#join-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (lobbyBusy) return;
    const input = document.querySelector<HTMLInputElement>('#room-code');
    joinDraft = normalizeRoomCode(input?.value ?? joinDraft);
    if (!isRoomCode(joinDraft)) {
      message = '请输入 6 位纯数字房间号。'; render();
      document.querySelector<HTMLInputElement>('#room-code')?.focus();
      return;
    }
    lobbyBusy = true;
    message = '';
    render();
    try {
      const body = await api<{ identity: RoomIdentity }>(`/api/rooms/${joinDraft}/join`, { method: 'POST' });
      saveIdentity(body.identity);
      message = '已加入房间。';
      await connectIdentity();
    } catch (error) { message = error instanceof Error ? error.message : '加入失败'; }
    finally { lobbyBusy = false; render(); }
  });
}

function renderWaiting(): void {
  if (!identity || !view) return;
  app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">📡</div><h2>房间 ${view.roomId}</h2><p class="subtle">把房间号或邀请链接发给另一名玩家。</p>${roomRuleHtml()}<div class="room-code-big">${view.roomId}</div><div class="controls room-controls">${button('复制邀请链接', 'copy-link', 'action primary')}${button('退出房间', 'leave-room')}</div><div class="player-status"><span>玩家 A · ${connectionLabel('A')}</span><span>玩家 B · ${connectionLabel('B')}</span></div>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}</div></section>`, `房间 ${view.roomId}`);
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); });
  document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}

function renderPlacement(): void {
  if (!identity || !view) return;
  const me = view.players[identity.playerId];
  const opponent: PlayerId = identity.playerId === 'A' ? 'B' : 'A';
  const legal = localFleet.length === 3 && validatePlacement(localFleet).valid;
  const locked = me.ready || submitting;
  app.innerHTML = shell(`<section class="panel game-layout deployment-layout"><div class="board-wrap"><div class="board-title"><div><span class="eyebrow">DEPLOYMENT / 玩家 ${identity.playerId}</span><strong>${locked ? '你的编队已锁定' : '部署你的编队'}</strong></div><span class="board-hint">${locked ? '等待对手准备' : '拖动移动 · 点击旋转'}</span></div>${fleetBoard(localFleet, selectedPlaneId, locked)}<div class="board-footer"><span><i class="dot"></i> 数字标记为机头</span><span>对手无法看到你的布局</span></div></div><aside class="sidebar"><div class="phase-card"><span class="phase-indicator ${locked ? 'waiting' : ''}"></span><div><strong>房间 ${view.roomId}</strong><p>你 · ${locked ? '已锁定' : '布阵中'} / 对手 · ${view.players[opponent].ready ? '已准备' : connectionLabel(opponent)}</p></div></div>${roomRuleHtml()}${fleetTools(localFleet, selectedPlaneId, placementHistory.length > 0, locked)}<div class="status placement-status" role="status" aria-live="polite">${escapeHtml(message || '已摆好 3 架飞机，拖动调整位置，点击飞机旋转。')}</div><div class="controls primary-controls">${button(submitting ? '正在提交布局…' : me.ready ? '已准备 · 等待对手' : !legal ? '请先消除飞机重叠' : '确认布阵 · 准备战斗 →', 'ready', 'action primary', locked || !legal)}</div><div class="room-actions">${button('复制邀请', 'copy-link')}${button('退出房间', 'leave-room')}</div></aside></section>`, `房间 ${view.roomId}`);

  if (!locked) {
    const updateFleet = (next: Plane[]) => {
      if (!view || view.status !== 'PLACEMENT' || view.players[identity!.playerId].ready) return;
      placementHistory.push(localFleet); localFleet = next; render();
    };
    bindFleetEditor({ fleet: localFleet, selectedId: selectedPlaneId, onSelect: (id) => { selectedPlaneId = id; }, onChange: updateFleet, onMessage: (next) => {
      message = next;
      const status = document.querySelector('.placement-status');
      if (status) status.textContent = next;
    }, onGesture: (active) => { placementGesture = active; if (!active) render(); } });
    document.querySelector('#random')?.addEventListener('click', () => { message = '已生成新的随机布局。'; updateFleet(randomFleet(identity!.playerId.toLowerCase())); });
    document.querySelector('#undo-placement')?.addEventListener('click', () => { const previous = placementHistory.pop(); if (previous) localFleet = previous; message = '已撤销上一次调整。'; render(); });
    document.querySelector('#reset')?.addEventListener('click', () => { message = '已恢复初始编队。'; updateFleet(defaultFleet(identity!.playerId.toLowerCase())); });
    document.querySelector('#ready')?.addEventListener('click', async () => {
      if (submitting || !legal) return;
      submitting = true;
      const submittedFleet = localFleet;
      render();
      try {
        await api(`/api/rooms/${identity!.roomId}/fleet`, { method: 'POST', body: JSON.stringify({ token: identity!.token, planes: submittedFleet }) });
        const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity!.roomId}/ready`, { method: 'POST', body: JSON.stringify({ token: identity!.token }) });
        message = body.view.status === 'PLACEMENT' ? '布局已锁定，等待对手准备。' : ''; applyView(body.view);
      } catch (error) { message = error instanceof Error ? error.message : '准备失败'; }
      finally { submitting = false; render(); }
    });
  }
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); });
  document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}

function renderBattle(): void {
  if (!identity || !view) return;
  const enemy: PlayerId = identity.playerId === 'A' ? 'B' : 'A';
  const result = playback.result?.attack;
  const myTurn = !result && view.currentPlayerId === identity.playerId;
  const interactive = !result && !attackPending && activeBoard === 'ENEMY' && myTurn;
  const target = result?.position ?? selectedTarget;
  const targetLabel = target ? coordLabel(target) : '未选择';
  const canFire = !attackPending && interactive && selectedTarget ? canAttackCell(view, selectedTarget) : false;
  const myAttacks = view.attacks.filter((record) => record.attackerId === identity!.playerId);
  app.innerHTML = shell(`<section class="panel game-layout battle-layout">
    <div class="board-wrap">
      <div class="board-title"><div><span class="eyebrow">BATTLE / 房间 ${view.roomId}</span><strong>${activeBoard === 'ENEMY' ? '敌方战场' : '我的战场'}</strong></div><span>${activeBoard === 'ENEMY' ? `已击落 ${view.destroyedCounts[enemy]}/3` : `损失 ${view.destroyedCounts[identity.playerId]}/3`}</span></div>
      <div class="board-tabs"><button id="enemy-tab" class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}" ${result || attackPending ? 'disabled' : ''}>敌方战场</button><button id="own-tab" class="tab ${activeBoard === 'OWN' ? 'active' : ''}" ${result || attackPending ? 'disabled' : ''}>我的战场</button></div>
      ${boardHtml(activeBoard, interactive)}
      <div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击中机头</span></div>
    </div>
    <aside class="sidebar">
      <div class="phase-card"><span class="phase-indicator ${myTurn ? '' : 'waiting'}"></span><div><strong>${result ? '攻击结果' : myTurn ? '轮到你攻击' : '对手正在行动'}</strong><p>${result ? '查看落点反馈后自动继续。' : `对手 · ${connectionLabel(enemy)}`}</p></div></div>
      ${roomRuleHtml()}
      <div class="target-card"><span>${result ? '本次攻击坐标' : '已锁定坐标'}</span><strong>${target ? targetLabel : '—'}</strong><span>已攻击 ${myAttacks.length} 次 · 损失 ${view.destroyedCounts[identity.playerId]}/3 架</span></div>
      <div class="status" role="status">${escapeHtml(message || (myTurn ? '选择敌方一个未攻击坐标。' : '对手行动后会自动更新。'))}</div>
      <div class="controls primary-controls">${button(result ? '正在显示攻击结果…' : attackPending ? '攻击中…' : selectedTarget ? `确认攻击 ${targetLabel} →` : myTurn ? '先在地图上选择目标' : '等待对手攻击', 'fire', 'action primary', !canFire)}</div>
    </aside>
  </section>`, result ? '攻击结果' : myTurn ? '你的回合' : '等待对手');

  document.querySelector('#enemy-tab')?.addEventListener('click', () => { activeBoard = 'ENEMY'; render(); });
  document.querySelector('#own-tab')?.addEventListener('click', () => { activeBoard = 'OWN'; selectedTarget = null; render(); });
  if (interactive) {
    document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
      const next = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
      selectedTarget = next;
      message = canAttackCell(view!, next) ? `已锁定 ${coordLabel(next)}，点击攻击按钮确认。` : `${coordLabel(next)} 已经攻击过。`;
      render();
    }));
  }
  document.querySelector('#fire')?.addEventListener('click', async () => {
    if (playback.result || attackPending || !selectedTarget || activeBoard !== 'ENEMY' || !canAttackCell(view!, selectedTarget)) return;
    const target = selectedTarget;
    attackPending = true;
    render();
    try {
      const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity!.roomId}/attack`, { method: 'POST', body: JSON.stringify({ token: identity!.token, x: target.x, y: target.y }) });
      selectedTarget = null;
      applyView(body.view);
    } catch (error) {
      const confirmed = playback.latest?.attacks.some((record) => record.attackerId === identity?.playerId && posKey(record.position) === posKey(target));
      if (!confirmed) message = error instanceof Error ? error.message : '攻击失败';
    }
    finally { attackPending = false; render(); }
  });
}

function renderFinished(): void {
  if (!identity || !view) return;
  const won = view.winnerId === identity.playerId;
  const enemy: PlayerId = identity.playerId === 'A' ? 'B' : 'A';
  const myAttacks = view.attacks.filter((record) => record.attackerId === identity!.playerId);
  const hits = myAttacks.filter((record) => record.kind !== 'MISS').length;
  const voted = view.rematchVotes[identity.playerId];
  const finalTitle = activeBoard === 'ENEMY' ? `敌方最终战场 · 玩家 ${enemy}` : '我的最终战场';
  app.innerHTML = shell(`<section class="panel"><div class="result"><h2>${won ? '🎉 你赢了' : '战斗结束'}</h2><p class="subtle">${won ? '你率先击落了对方全部战机。' : `玩家 ${view.winnerId} 获胜。`}</p><div class="result-grid"><div class="card">攻击次数<strong>${myAttacks.length}</strong></div><div class="card">命中次数<strong>${hits}</strong></div><div class="card">击落战机<strong>${view.destroyedCounts[enemy]}</strong></div></div></div><div class="final-board-section"><div class="board-wrap"><div class="board-tabs"><button id="enemy-tab" class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}">敌方最终战场</button><button id="own-tab" class="tab ${activeBoard === 'OWN' ? 'active' : ''}">我的最终战场</button></div><div class="board-title"><strong>${finalTitle}</strong><span>完整布局已公开</span></div>${boardHtml(activeBoard, false)}<div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击中机头</span><span><i class="dot head-dot"></i> 最终机头</span></div></div></div><div class="controls result-controls">${button(voted ? '已申请再来一局' : '再来一局', 'rematch', 'action primary', voted)}${button('退出房间', 'leave-room')}</div>${message ? `<div class="notice result-notice">${escapeHtml(message)}</div>` : ''}</section>`, '战斗结束');
  document.querySelector('#enemy-tab')?.addEventListener('click', () => { activeBoard = 'ENEMY'; render(); });
  document.querySelector('#own-tab')?.addEventListener('click', () => { activeBoard = 'OWN'; render(); });
  document.querySelector('#rematch')?.addEventListener('click', async () => {
    try {
      const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity!.roomId}/rematch`, { method: 'POST', body: JSON.stringify({ token: identity!.token }) });
      message = '已申请再来一局，等待对方确认。'; applyView(body.view);
    } catch (error) { message = error instanceof Error ? error.message : '操作失败'; render(); }
  });
  document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}

function render(): void {
  if (placementGesture) return;
  if (!identity) return renderLanding();
  if (!view) {
    app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">📡</div><h2>正在连接房间</h2><p class="subtle">${escapeHtml(message || identity.roomId)}</p></div></section>`, `房间 ${identity.roomId}`);
    return;
  }
  if (view.status === 'WAITING') return renderWaiting();
  if (view.status === 'PLACEMENT') return renderPlacement();
  if (playback.result || view.status === 'PLAYING') return renderBattle();
  renderFinished();
}

render();
if (identity) void connectIdentity();
