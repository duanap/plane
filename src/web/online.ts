import { planeCells, validatePlacement } from '../game/geometry.ts';
import type { Plane, PlaneCell, Position } from '../game/types.ts';
import { attackClassFor, canAttackCell, coordLabel, isRoomCode, normalizeRoomCode, revealedCellKindFor, type BoardPerspective } from '../online/client-model.ts';
import type { PlayerId, PublicRoomView, RoomIdentity } from '../online/room-store.ts';
import { createPlacementFleet, dragCandidate, planeAt, rotateCandidate, type PlacementCandidate } from './placement-model.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

const STORAGE_KEY = 'plane-online-identity';
const invitedRoom = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
type DragState = { planeId: string; grabbed: Position; preview?: PlacementCandidate };

let identity: RoomIdentity | null = loadIdentity();
let view: PublicRoomView | null = null;
let eventSource: EventSource | null = null;
let localFleet: Plane[] = [];
let selectedPlaneId: string | null = null;
let selectedTarget: Position | null = null;
let activeBoard: BoardPerspective = 'ENEMY';
let hostRevealRule = true;
let drag: DragState | null = null;
let message = '';

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!); }
function button(label: string, id: string, className = 'action', disabled = false): string { return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`; }
function shell(content: string, badge = '在线对战'): string { return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>双人实时坐标推理对战</p></div><div class="top-actions"><a class="text-link" href="/">模式首页</a><span class="badge">${escapeHtml(badge)}</span></div></header>${content}</div>`; }
function posKey(position: Position): string { return `${position.x}:${position.y}`; }

function loadIdentity(): RoomIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomIdentity>;
    if (!parsed.roomId || !isRoomCode(parsed.roomId) || (parsed.playerId !== 'A' && parsed.playerId !== 'B') || typeof parsed.token !== 'string') return null;
    if (invitedRoom && normalizeRoomCode(parsed.roomId) !== invitedRoom) return null;
    return { roomId: normalizeRoomCode(parsed.roomId), playerId: parsed.playerId, token: parsed.token };
  } catch { return null; }
}
function saveIdentity(next: RoomIdentity): void { identity = next; localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); history.replaceState(null, '', `/online.html?room=${encodeURIComponent(next.roomId)}`); }
function leaveRoom(): void { eventSource?.close(); eventSource = null; identity = null; view = null; localFleet = []; selectedPlaneId = null; selectedTarget = null; drag = null; localStorage.removeItem(STORAGE_KEY); history.replaceState(null, '', '/online.html'); message = ''; render(); }
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json() as { ok: boolean; error?: { message: string } } & T;
  if (!response.ok || !body.ok) throw new Error(body.error?.message ?? '请求失败');
  return body;
}
function applyView(next: PublicRoomView): void {
  const enteringPlacement = !view || (view.status !== 'PLACEMENT' && next.status === 'PLACEMENT');
  view = next;
  if (enteringPlacement) {
    localFleet = next.ownFleet?.map((p) => ({ ...p, head: { ...p.head } })) ?? createPlacementFleet(next.playerId.toLowerCase());
    selectedPlaneId = localFleet[0]?.id ?? null;
    selectedTarget = null;
  }
  if (next.status === 'FINISHED') { activeBoard = 'ENEMY'; selectedTarget = null; }
  render();
}
async function refreshState(): Promise<void> { if (!identity) return; const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity.roomId}/state?token=${encodeURIComponent(identity.token)}`); applyView(body.view); }
function openEvents(): void {
  if (!identity) return; eventSource?.close();
  eventSource = new EventSource(`/api/rooms/${identity.roomId}/events?token=${encodeURIComponent(identity.token)}`);
  eventSource.addEventListener('state', (event) => { const payload = JSON.parse((event as MessageEvent<string>).data) as { ok: true; view: PublicRoomView }; applyView(payload.view); });
  eventSource.onerror = () => { message = '连接暂时中断，正在自动重连…'; render(); };
}
async function connectIdentity(): Promise<void> { if (!identity) return; try { await refreshState(); openEvents(); } catch (error) { message = error instanceof Error ? error.message : '无法恢复房间'; localStorage.removeItem(STORAGE_KEY); identity = null; view = null; render(); } }

function planeMap(fleet: Plane[]): Map<string, PlaneCell> { const map = new Map<string, PlaneCell>(); for (const plane of fleet) for (const cell of planeCells(plane)) map.set(posKey(cell.position), cell); return map; }
function placementBoard(): string {
  const candidate = drag?.preview ?? null; const fleet = candidate?.fleet ?? localFleet; const cells = planeMap(fleet); const invalidPlane = candidate && !candidate.valid ? drag?.planeId : null;
  let html = '<div class="board placement-board" id="online-placement-board">';
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) {
    const pos = { x, y }; const cell = cells.get(posKey(pos)); const classes = ['cell'];
    if (cell) { classes.push('plane', cell.kind === 'HEAD' ? 'head' : 'body'); if (cell.planeId === selectedPlaneId) classes.push('plane-selected'); if (cell.planeId === invalidPlane) classes.push('invalid'); }
    html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coordLabel(pos)}"></button>`;
  }
  return `${html}</div>`;
}
function battleBoard(perspective: BoardPerspective, interactive: boolean): string {
  if (!view) return '';
  const own = perspective === 'OWN' ? planeMap(view.ownFleet ?? []) : new Map<string, PlaneCell>();
  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) {
    const pos = { x, y }; const key = posKey(pos); const classes = ['cell']; const ownCell = own.get(key); const mark = attackClassFor(view, perspective, pos); const revealed = revealedCellKindFor(view, perspective, pos);
    if (ownCell) classes.push('plane', ownCell.kind === 'HEAD' ? 'head' : 'body');
    if (mark) classes.push(mark);
    if (revealed) classes.push('revealed', revealed === 'HEAD' ? 'revealed-head' : 'revealed-body');
    if (perspective === 'ENEMY' && selectedTarget && posKey(selectedTarget) === key) classes.push('selected');
    html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coordLabel(pos)}" ${interactive ? '' : 'tabindex="-1"'}></button>`;
  }
  return `${html}</div>`;
}
function connectionLabel(id: PlayerId): string { if (!view) return ''; const player = view.players[id]; if (!player.joined) return '等待加入'; return player.connected ? '在线' : '离线/重连中'; }
function inviteUrl(): string { return identity ? `${location.origin}/online.html?room=${identity.roomId}` : location.href; }

function renderLanding(): void {
  const prefill = isRoomCode(invitedRoom) ? invitedRoom : '';
  app.innerHTML = shell(`<section class="panel online-home"><div class="online-hero"><div class="handoff-icon">🌐</div><h2>在线双人对战</h2><p class="subtle">房主选择本局规则并创建房间，双方在各自设备部署战机。</p></div><div class="rule-choice"><label class="rule-option ${hostRevealRule ? 'active' : ''}"><input type="radio" name="host-reveal" value="yes" ${hostRevealRule ? 'checked' : ''}><strong>击落后显示完整轮廓</strong><span>击中机头后公开完整飞机。</span></label><label class="rule-option ${!hostRevealRule ? 'active' : ''}"><input type="radio" name="host-reveal" value="no" ${!hostRevealRule ? 'checked' : ''}><strong>击落后不显示轮廓</strong><span>只保留 ✹ 与已知攻击标记。</span></label></div><div class="online-actions">${button('创建房间', 'create-room', 'action primary')}<div class="join-row"><input id="room-code" class="room-input" maxlength="6" autocomplete="off" placeholder="6 位房间码" value="${escapeHtml(prefill)}">${button('加入房间', 'join-room')}</div><a class="action-link" href="/">返回模式首页</a></div>${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ''}</section>`);
  document.querySelectorAll<HTMLInputElement>('input[name="host-reveal"]').forEach((item) => item.addEventListener('change', () => { hostRevealRule = item.value === 'yes'; render(); }));
  document.querySelector('#create-room')?.addEventListener('click', async () => { try { const body = await api<{ identity: RoomIdentity }>('/api/rooms', { method: 'POST', body: JSON.stringify({ revealDestroyedPlane: hostRevealRule }) }); saveIdentity(body.identity); message = '房间已创建，等待另一名玩家加入。'; await connectIdentity(); } catch (error) { message = error instanceof Error ? error.message : '创建失败'; render(); } });
  document.querySelector('#join-room')?.addEventListener('click', async () => { const input = document.querySelector<HTMLInputElement>('#room-code'); const code = normalizeRoomCode(input?.value ?? ''); if (!isRoomCode(code)) { message = '请输入正确的 6 位房间码。'; render(); return; } try { const body = await api<{ identity: RoomIdentity }>(`/api/rooms/${code}/join`, { method: 'POST' }); saveIdentity(body.identity); message = '已加入房间。'; await connectIdentity(); } catch (error) { message = error instanceof Error ? error.message : '加入失败'; render(); } });
}
function renderWaiting(): void {
  if (!view) return;
  app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">📡</div><h2>房间 ${view.roomId}</h2><p class="subtle">本局规则：击落后${view.rules.revealDestroyedPlane ? '显示完整轮廓' : '不显示完整轮廓'}</p><div class="room-code-big">${view.roomId}</div><div class="controls room-controls">${button('复制邀请链接', 'copy-link', 'action primary')}${button('退出房间', 'leave-room')}</div><div class="player-status"><span>玩家 A · ${connectionLabel('A')}</span><span>玩家 B · ${connectionLabel('B')}</span></div></div></section>`, `房间 ${view.roomId}`);
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); }); document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}
function renderPlacement(): void {
  if (!identity || !view) return; const me = view.players[identity.playerId]; const opponent: PlayerId = identity.playerId === 'A' ? 'B' : 'A'; const legal = localFleet.length === 3 && validatePlacement(localFleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-title"><strong>玩家 ${identity.playerId} · 部署战机</strong><span>拖拽整架飞机</span></div>${placementBoard()}<div class="legend"><span><i class="dot"></i> 战机</span><span>蓝框 = 当前选择</span><span>红色 = 非法位置</span></div></div><aside class="sidebar"><div class="card"><h3>房间 ${view.roomId}</h3><div class="statline"><span>本局规则</span><b>${view.rules.revealDestroyedPlane ? '击落显示轮廓' : '击落隐藏轮廓'}</b></div><div class="statline"><span>你</span><b>${me.ready ? '已准备' : connectionLabel(identity.playerId)}</b></div><div class="statline"><span>对手</span><b>${view.players[opponent].ready ? '已准备' : connectionLabel(opponent)}</b></div></div>${me.ready ? `<div class="card status">布局已锁定，等待对手准备。</div>` : `<div class="card status">${escapeHtml(message || '拖动飞机调整位置，选中后可旋转。')}</div><div class="controls">${button('旋转选中飞机 ↻', 'rotate-plane', 'action', !selectedPlaneId)}${button('随机重新摆放', 'random-fleet')}${button('准备战斗', 'ready', 'action primary', !legal)}</div>`}<div class="controls">${button('复制邀请链接', 'copy-link')}${button('退出房间', 'leave-room')}</div></aside></section>`, `房间 ${view.roomId}`);
  if (!me.ready) {
    document.querySelectorAll<HTMLButtonElement>('#online-placement-board .cell').forEach((cell) => cell.addEventListener('pointerdown', (event) => { const pos = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }; const plane = planeAt(localFleet, pos); if (!plane) return; event.preventDefault(); selectedPlaneId = plane.id; drag = { planeId: plane.id, grabbed: pos }; render(); }));
    document.querySelector('#rotate-plane')?.addEventListener('click', () => { if (!selectedPlaneId) return; const result = rotateCandidate(localFleet, selectedPlaneId); if (result.valid) { localFleet = result.fleet; message = '已旋转选中飞机。'; } else message = '该方向会出界或重叠，已保持原方向。'; render(); });
    document.querySelector('#random-fleet')?.addEventListener('click', () => { localFleet = createPlacementFleet(identity!.playerId.toLowerCase()); selectedPlaneId = localFleet[0].id; message = '已生成新的合法随机布局。'; render(); });
    document.querySelector('#ready')?.addEventListener('click', async () => { try { await api(`/api/rooms/${view!.roomId}/fleet`, { method: 'POST', body: JSON.stringify({ token: identity!.token, planes: localFleet }) }); const body = await api<{ view: PublicRoomView }>(`/api/rooms/${view!.roomId}/ready`, { method: 'POST', body: JSON.stringify({ token: identity!.token }) }); applyView(body.view); } catch (error) { message = error instanceof Error ? error.message : '准备失败'; render(); } });
  }
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); }); document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}
function renderBattle(): void {
  if (!identity || !view) return; const myTurn = view.currentPlayerId === identity.playerId; const opponent: PlayerId = identity.playerId === 'A' ? 'B' : 'A'; const label = selectedTarget ? coordLabel(selectedTarget) : '未选择'; const canFire = selectedTarget ? canAttackCell(view, selectedTarget) : false;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-tabs"><button class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}" data-board="ENEMY">敌方战场</button><button class="tab ${activeBoard === 'OWN' ? 'active' : ''}" data-board="OWN">我的战场</button></div><div class="board-title"><strong>${activeBoard === 'ENEMY' ? `玩家 ${opponent} 战场` : '我的战场'}</strong><span>${activeBoard === 'ENEMY' ? `已击落 ${view.destroyedCounts[opponent]}/3` : `已损失 ${view.destroyedCounts[identity.playerId]}/3`}</span></div>${battleBoard(activeBoard, myTurn && activeBoard === 'ENEMY')}<div class="legend"><span class="miss-mark">○ 未命中</span><span class="hit-mark">× 命中</span><span class="destroyed-mark">✹ 击落</span></div></div><aside class="sidebar"><div class="card"><h3>${myTurn ? '你的回合' : '等待对手'}</h3><div class="statline"><span>目标</span><b>${label}</b></div><div class="statline"><span>本局规则</span><b>${view.rules.revealDestroyedPlane ? '击落显示轮廓' : '击落隐藏轮廓'}</b></div></div><div class="card status">${escapeHtml(message || (myTurn ? '选择一个未攻击坐标。' : '对手正在行动…'))}</div><div class="controls">${button(selectedTarget ? `攻击 ${label}` : '请选择目标', 'fire', 'action primary', !myTurn || activeBoard !== 'ENEMY' || !canFire)}</div></aside></section>`, `房间 ${view.roomId}`);
  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((tab) => tab.addEventListener('click', () => { activeBoard = tab.dataset.board as BoardPerspective; selectedTarget = null; render(); }));
  if (myTurn && activeBoard === 'ENEMY') document.querySelectorAll<HTMLButtonElement>('.board .cell').forEach((cell) => cell.addEventListener('click', () => { selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }; message = canAttackCell(view!, selectedTarget) ? `已选择 ${coordLabel(selectedTarget)}，点击攻击确认。` : `${coordLabel(selectedTarget)} 已攻击过。`; render(); }));
  document.querySelector('#fire')?.addEventListener('click', async () => { if (!selectedTarget || !identity || !view) return; const target = { ...selectedTarget }; try { const body = await api<{ result: { kind: string }; view: PublicRoomView }>(`/api/rooms/${view.roomId}/attack`, { method: 'POST', body: JSON.stringify({ token: identity.token, x: target.x, y: target.y }) }); message = `${coordLabel(target)}：${body.result.kind === 'MISS' ? '未命中 ○' : body.result.kind === 'HIT' ? '命中机身 ×' : '击中机头 ✹'}。`; selectedTarget = null; applyView(body.view); } catch (error) { message = error instanceof Error ? error.message : '攻击失败'; render(); } });
}
function renderFinished(): void {
  if (!identity || !view) return; const won = view.winnerId === identity.playerId;
  app.innerHTML = shell(`<section class="panel result"><h2>${won ? '你赢了' : '对手获胜'}</h2><p class="subtle">战斗结束，双方完整布局已公开。</p><div class="final-board-section"><h3>对手最终战场</h3>${battleBoard('ENEMY', false)}</div><div class="controls result-controls">${button(view.rematchVotes[identity.playerId] ? '已申请再来一局' : '再来一局', 'rematch', 'action primary', view.rematchVotes[identity.playerId])}${button('退出房间', 'leave-room')}</div></section>`, '战斗结束');
  document.querySelector('#rematch')?.addEventListener('click', async () => { try { const body = await api<{ view: PublicRoomView }>(`/api/rooms/${view!.roomId}/rematch`, { method: 'POST', body: JSON.stringify({ token: identity!.token }) }); applyView(body.view); } catch (error) { message = error instanceof Error ? error.message : '操作失败'; render(); } }); document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}
function render(): void { if (!identity) return renderLanding(); if (!view) { app.innerHTML = shell('<section class="panel handoff"><div class="handoff-inner"><h2>正在恢复房间…</h2></div></section>'); return; } if (view.status === 'WAITING') renderWaiting(); else if (view.status === 'PLACEMENT') renderPlacement(); else if (view.status === 'PLAYING') renderBattle(); else renderFinished(); }

window.addEventListener('pointermove', (event) => { if (!drag || !view || view.status !== 'PLACEMENT') return; const board = document.querySelector<HTMLElement>('#online-placement-board'); if (!board) return; const rect = board.getBoundingClientRect(); const x = Math.floor(((event.clientX - rect.left) / rect.width) * 10); const y = Math.floor(((event.clientY - rect.top) / rect.height) * 10); if (x < 0 || x > 9 || y < 0 || y > 9) return; const next = dragCandidate(localFleet, drag.planeId, drag.grabbed, { x, y }); const oldHead = drag.preview?.fleet.find((p) => p.id === drag!.planeId)?.head; const newHead = next.fleet.find((p) => p.id === drag!.planeId)?.head; if (oldHead?.x === newHead?.x && oldHead?.y === newHead?.y && drag.preview?.valid === next.valid) return; drag.preview = next; render(); });
window.addEventListener('pointerup', () => { if (!drag) return; if (drag.preview?.valid) { localFleet = drag.preview.fleet; message = '飞机位置已更新。'; } else if (drag.preview) message = '该位置出界或重叠，已恢复原位置。'; drag = null; render(); });

render();
if (identity) void connectIdentity();
