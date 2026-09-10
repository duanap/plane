import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Direction, Plane, Position } from '../game/types.ts';
import { attackClassFor, canAttackCell, coordLabel, isRoomCode, normalizeRoomCode, revealedCellKindFor, type BoardPerspective } from '../online/client-model.ts';
import type { PlayerId, PublicRoomView, RoomIdentity } from '../online/room-store.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

const STORAGE_KEY = 'plane-online-identity';
const directions: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const directionText: Record<Direction, string> = { UP: '↑ 向上', RIGHT: '→ 向右', DOWN: '↓ 向下', LEFT: '← 向左' };
const invitedRoom = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');

let identity: RoomIdentity | null = loadIdentity();
let view: PublicRoomView | null = null;
let eventSource: EventSource | null = null;
let localFleet: Plane[] = [];
let placementDirection: Direction = 'UP';
let selectedTarget: Position | null = null;
let activeBoard: BoardPerspective = 'ENEMY';
let message = '';

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
  eventSource?.close();
  eventSource = null;
  identity = null;
  view = null;
  localFleet = [];
  selectedTarget = null;
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
  const enteringPlacement = !view || (view.status !== 'PLACEMENT' && next.status === 'PLACEMENT');
  const enteringFinished = Boolean(view && view.status !== 'FINISHED' && next.status === 'FINISHED');
  view = next;
  if (enteringPlacement) {
    localFleet = next.ownFleet?.map((plane) => ({ ...plane, head: { ...plane.head } })) ?? [];
    placementDirection = 'UP';
    selectedTarget = null;
  }
  if (enteringFinished) {
    activeBoard = 'ENEMY';
    selectedTarget = null;
  }
  render();
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
    message = error instanceof Error ? error.message : '无法恢复房间';
    localStorage.removeItem(STORAGE_KEY);
    identity = null;
    view = null;
    render();
  }
}

function button(label: string, id: string, className = 'action', disabled = false): string {
  return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`;
}

function shell(content: string, badge = '在线对战'): string {
  return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>双人实时坐标推理对战</p></div><div class="top-actions"><a class="text-link" href="/">本地双人</a><span class="badge">${escapeHtml(badge)}</span></div></header>${content}</div>`;
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
      const revealedKind = revealedCellKindFor(view, perspective, position);
      if (ownCell) classes.push('plane', ownCell.kind === 'HEAD' ? 'head' : 'body');
      if (ownCell?.destroyed) classes.push('revealed');
      if (attackClass) classes.push(attackClass);
      if (revealedKind) classes.push('revealed', revealedKind === 'HEAD' ? 'revealed-head' : 'revealed-body');
      if (perspective === 'ENEMY' && selectedTarget && posKey(selectedTarget) === key) classes.push('selected');
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coordLabel(position)}" aria-label="${coordLabel(position)}" ${interactive ? '' : 'tabindex="-1"'}></button>`;
    }
  }
  return html + '</div>';
}

function placementBoardHtml(): string {
  const map = ownCellMap(localFleet);
  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const cell = map.get(posKey(position));
      const classes = ['cell'];
      if (cell) classes.push('plane', cell.kind === 'HEAD' ? 'head' : 'body');
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coordLabel(position)}" aria-label="${coordLabel(position)}"></button>`;
    }
  }
  return html + '</div>';
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

function renderLanding(): void {
  const prefill = isRoomCode(invitedRoom) ? invitedRoom : '';
  app.innerHTML = shell(`<section class="panel online-home">
    <div class="online-hero"><div class="handoff-icon">✈️</div><h2>在线双人对战</h2><p class="subtle">创建房间，把链接发给朋友。双方各自在自己的设备部署战机。</p></div>
    <div class="online-actions">${button('创建房间', 'create-room', 'action primary')}<div class="join-row"><input id="room-code" class="room-input" maxlength="6" autocomplete="off" placeholder="6 位房间码" value="${escapeHtml(prefill)}" />${button('加入房间', 'join-room')}</div><a class="action-link" href="/">返回本地双人模式</a></div>
    ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ''}
  </section>`);

  document.querySelector('#create-room')?.addEventListener('click', async () => {
    try {
      const body = await api<{ identity: RoomIdentity }>('/api/rooms', { method: 'POST' });
      saveIdentity(body.identity);
      message = '房间已创建，等待另一名玩家加入。';
      await connectIdentity();
    } catch (error) { message = error instanceof Error ? error.message : '创建失败'; render(); }
  });
  document.querySelector('#join-room')?.addEventListener('click', async () => {
    const input = document.querySelector<HTMLInputElement>('#room-code');
    const code = normalizeRoomCode(input?.value ?? '');
    if (!isRoomCode(code)) { message = '请输入正确的 6 位房间码。'; render(); return; }
    try {
      const body = await api<{ identity: RoomIdentity }>(`/api/rooms/${code}/join`, { method: 'POST' });
      saveIdentity(body.identity);
      message = '已加入房间。';
      await connectIdentity();
    } catch (error) { message = error instanceof Error ? error.message : '加入失败'; render(); }
  });
}

function renderWaiting(): void {
  if (!identity || !view) return;
  app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">📡</div><h2>房间 ${view.roomId}</h2><p class="subtle">把房间码或邀请链接发给另一名玩家。</p><div class="room-code-big">${view.roomId}</div><div class="controls room-controls">${button('复制邀请链接', 'copy-link', 'action primary')}${button('退出房间', 'leave-room')}</div><div class="player-status"><span>玩家 A · ${connectionLabel('A')}</span><span>玩家 B · ${connectionLabel('B')}</span></div>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ''}</div></section>`, `房间 ${view.roomId}`);
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); });
  document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}

function renderPlacement(): void {
  if (!identity || !view) return;
  const me = view.players[identity.playerId];
  const opponent: PlayerId = identity.playerId === 'A' ? 'B' : 'A';
  const legal = localFleet.length === 3 && validatePlacement(localFleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-title"><strong>玩家 ${identity.playerId} · 部署战机</strong><span>${localFleet.length}/3 架</span></div>${placementBoardHtml()}<div class="legend" style="margin-top:12px"><span><i class="dot"></i> 你的战机</span><span>对手无法看到这里</span></div></div><aside class="sidebar"><div class="card"><h3>房间 ${view.roomId}</h3><div class="statline"><span>你</span><b>${me.ready ? '已准备' : connectionLabel(identity.playerId)}</b></div><div class="statline"><span>对手</span><b>${view.players[opponent].ready ? '已准备' : connectionLabel(opponent)}</b></div></div>${me.ready ? `<div class="card status">布局已锁定，等待对手准备。</div>` : `<div class="card"><h3>当前方向</h3><div style="font-size:26px">${directionText[placementDirection]}</div></div><div class="card status">${escapeHtml(message || '点击棋盘放置机头。')}</div><div class="controls">${button('旋转战机 ↻', 'rotate')}${button('随机摆放 3 架', 'random')}${button('撤销最后一架', 'undo', 'action', localFleet.length === 0)}${button('重新摆放', 'reset', 'action danger', localFleet.length === 0)}${button('准备战斗', 'ready', 'action primary', !legal)}</div>`}<div class="controls">${button('复制邀请链接', 'copy-link')}${button('退出房间', 'leave-room')}</div></aside></section>`, `房间 ${view.roomId}`);

  if (!me.ready) {
    document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
      if (localFleet.length >= 3) { message = '已经摆满 3 架飞机。'; render(); return; }
      const candidate: Plane = { id: `${identity!.playerId.toLowerCase()}${localFleet.length + 1}`, head: { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }, direction: placementDirection, destroyed: false };
      const validation = validatePlacement([...localFleet, candidate]);
      if (!validation.valid) message = validation.reason === 'OUT_OF_BOUNDS' ? '这个位置会让飞机出界。' : '这个位置与已有飞机重叠。';
      else { localFleet = [...localFleet, candidate]; message = `已部署第 ${localFleet.length} 架，机头 ${coordLabel(candidate.head)}。`; }
      render();
    }));
    document.querySelector('#rotate')?.addEventListener('click', () => { placementDirection = directions[(directions.indexOf(placementDirection) + 1) % directions.length]; render(); });
    document.querySelector('#random')?.addEventListener('click', () => { localFleet = randomFleet(identity!.playerId.toLowerCase()); message = '已生成随机合法布局。'; render(); });
    document.querySelector('#undo')?.addEventListener('click', () => { localFleet = localFleet.slice(0, -1); message = '已撤销最后一架。'; render(); });
    document.querySelector('#reset')?.addEventListener('click', () => { localFleet = []; message = '布局已清空。'; render(); });
    document.querySelector('#ready')?.addEventListener('click', async () => {
      try {
        await api(`/api/rooms/${identity!.roomId}/fleet`, { method: 'POST', body: JSON.stringify({ token: identity!.token, planes: localFleet }) });
        const body = await api<{ view: PublicRoomView }>(`/api/rooms/${identity!.roomId}/ready`, { method: 'POST', body: JSON.stringify({ token: identity!.token }) });
        message = '准备完成。'; applyView(body.view);
      } catch (error) { message = error instanceof Error ? error.message : '准备失败'; render(); }
    });
  }
  document.querySelector('#copy-link')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); message = '邀请链接已复制。'; } catch { message = inviteUrl(); } render(); });
  document.querySelector('#leave-room')?.addEventListener('click', leaveRoom);
}

function renderBattle(): void {
  if (!identity || !view) return;
  const enemy: PlayerId = identity.playerId === 'A' ? 'B' : 'A';
  const myTurn = view.currentPlayerId === identity.playerId;
  const interactive = activeBoard === 'ENEMY' && myTurn;
  const targetLabel = selectedTarget ? coordLabel(selectedTarget) : '未选择';
  const canFire = selectedTarget ? canAttackCell(view, selectedTarget) : false;
  const myAttacks = view.attacks.filter((record) => record.attackerId === identity!.playerId);
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-tabs"><button id="enemy-tab" class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}">敌方战场</button><button id="own-tab" class="tab ${activeBoard === 'OWN' ? 'active' : ''}">我的战场</button></div><div class="board-title"><strong>${activeBoard === 'ENEMY' ? `敌方战场 · 玩家 ${enemy}` : '我的战场'}</strong><span>${activeBoard === 'ENEMY' ? `已击落 ${view.destroyedCounts[enemy]}/3` : `损失 ${view.destroyedCounts[identity.playerId]}/3`}</span></div>${boardHtml(activeBoard, interactive)}<div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击落机头</span></div></div><aside class="sidebar"><div class="card"><h3>${myTurn ? '你的回合' : '等待对方攻击'}</h3><div class="statline"><span>玩家 A</span><b>${connectionLabel('A')}</b></div><div class="statline"><span>玩家 B</span><b>${connectionLabel('B')}</b></div><div class="statline"><span>目标</span><b>${targetLabel}</b></div><div class="statline"><span>已攻击</span><b>${myAttacks.length} 次</b></div></div><div class="card status">${escapeHtml(message || (myTurn ? '选择敌方一个未攻击坐标。' : '对手行动后会自动更新。'))}</div><div class="controls">${button(selectedTarget ? `攻击 ${targetLabel}` : '请选择目标', 'fire', 'action primary', !canFire)}</div></aside></section>`, myTurn ? '你的回合' : '等待对手');

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
    if (!selectedTarget || !canAttackCell(view!, selectedTarget)) return;
    const target = selectedTarget;
    try {
      const body = await api<{ view: PublicRoomView; result: { kind: string } }>(`/api/rooms/${identity!.roomId}/attack`, { method: 'POST', body: JSON.stringify({ token: identity!.token, x: target.x, y: target.y }) });
      message = body.result.kind === 'MISS' ? `${coordLabel(target)}：未命中。` : body.result.kind === 'HIT' ? `${coordLabel(target)}：命中机身！` : `${coordLabel(target)}：击中机头，敌机被击落！`;
      selectedTarget = null;
      applyView(body.view);
    } catch (error) { message = error instanceof Error ? error.message : '攻击失败'; render(); }
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
  app.innerHTML = shell(`<section class="panel"><div class="result"><h2>${won ? '🎉 你赢了' : '战斗结束'}</h2><p class="subtle">${won ? '你率先击落了对方全部战机。' : `玩家 ${view.winnerId} 获胜。`}</p><div class="result-grid"><div class="card">攻击次数<strong>${myAttacks.length}</strong></div><div class="card">命中次数<strong>${hits}</strong></div><div class="card">击落战机<strong>${view.destroyedCounts[enemy]}</strong></div></div></div><div class="final-board-section"><div class="board-wrap"><div class="board-tabs"><button id="enemy-tab" class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}">敌方最终战场</button><button id="own-tab" class="tab ${activeBoard === 'OWN' ? 'active' : ''}">我的最终战场</button></div><div class="board-title"><strong>${finalTitle}</strong><span>完整布局已公开</span></div>${boardHtml(activeBoard, false)}<div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击落机头</span><span><i class="dot head-dot"></i> 最终机头</span></div></div></div><div class="controls result-controls">${button(voted ? '已申请再来一局' : '再来一局', 'rematch', 'action primary', voted)}${button('退出房间', 'leave-room')}</div>${message ? `<div class="notice result-notice">${escapeHtml(message)}</div>` : ''}</section>`, '战斗结束');
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
  if (!identity) return renderLanding();
  if (!view) {
    app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">📡</div><h2>正在连接房间</h2><p class="subtle">${escapeHtml(message || identity.roomId)}</p></div></section>`, `房间 ${identity.roomId}`);
    return;
  }
  if (view.status === 'WAITING') return renderWaiting();
  if (view.status === 'PLACEMENT') return renderPlacement();
  if (view.status === 'PLAYING') return renderBattle();
  renderFinished();
}

render();
if (identity) void connectIdentity();
