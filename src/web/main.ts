import { attack, createGame, GameRuleError, type GameState } from '../game/game.ts';
import { planeCells, validatePlacement } from '../game/geometry.ts';
import type { Plane, Position } from '../game/types.ts';
import {
  beginLocalFlow,
  confirmPlacement,
  endTurn,
  openTurn,
  recordAttackResult,
  startBattle,
  startSecondPlacement,
  type LocalFlowState,
  type LocalPlayerId,
} from '../local/flow.ts';
import { createPlacementFleet, dragCandidate, planeAt, rotateCandidate, type PlacementCandidate } from './placement-model.ts';

type BattleBoard = 'ENEMY' | 'OWN';
type DragState = { player: LocalPlayerId; planeId: string; grabbed: Position; preview?: PlacementCandidate };

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

let flow: LocalFlowState = beginLocalFlow();
let revealDestroyedPlane = true;
let fleets: Record<LocalPlayerId, Plane[]> = { A: [], B: [] };
let game: GameState | null = null;
let selectedPlaneId: string | null = null;
let selectedTarget: Position | null = null;
let activeBoard: BattleBoard = 'ENEMY';
let drag: DragState | null = null;
let message = '';
let lastAttackText = '';

function posKey(position: Position): string { return `${position.x}:${position.y}`; }
function coord(position: Position): string { return `${String.fromCharCode(65 + position.y)}${position.x + 1}`; }
function other(player: LocalPlayerId): LocalPlayerId { return player === 'A' ? 'B' : 'A'; }
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
}
function button(label: string, id: string, className = 'action', disabled = false): string {
  return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`;
}
function shell(content: string, badge: string): string {
  return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>本地双人 · 10×10 坐标推理对战</p></div><div class="top-actions"><a class="text-link" href="/">模式首页</a><span class="badge">${escapeHtml(badge)}</span></div></header>${content}</div>`;
}

function fleetCellMap(fleet: Plane[]): Map<string, { planeId: string; kind: 'HEAD' | 'BODY' }> {
  const map = new Map<string, { planeId: string; kind: 'HEAD' | 'BODY' }>();
  for (const plane of fleet) for (const cell of planeCells(plane)) map.set(posKey(cell.position), { planeId: plane.id, kind: cell.kind });
  return map;
}

function placementBoard(player: LocalPlayerId): string {
  const baseFleet = fleets[player];
  const candidate = drag?.player === player && drag.preview ? drag.preview : null;
  const visibleFleet = candidate?.fleet ?? baseFleet;
  const cells = fleetCellMap(visibleFleet);
  const invalidPlaneId = candidate && !candidate.valid ? drag?.planeId : null;
  let html = '<div class="board placement-board" id="placement-board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const data = cells.get(posKey(position));
      const classes = ['cell'];
      if (data) {
        classes.push('plane', data.kind === 'HEAD' ? 'head' : 'body');
        if (data.planeId === selectedPlaneId) classes.push('plane-selected');
        if (data.planeId === invalidPlaneId) classes.push('invalid');
      }
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coord(position)}"></button>`;
    }
  }
  return `${html}</div>`;
}

function attackMap(attacker: LocalPlayerId): Map<string, 'MISS' | 'HIT' | 'DESTROYED'> {
  return new Map((game?.attacks ?? []).filter((record) => record.attackerId === attacker).map((record) => [posKey(record.position), record.kind]));
}

function battleBoardHtml(viewer: LocalPlayerId, board: BattleBoard, interactive: boolean, revealAll = false): string {
  if (!game) return '';
  const ownId = viewer;
  const enemyId = other(viewer);
  const targetId = board === 'OWN' ? ownId : enemyId;
  const attacker = board === 'OWN' ? enemyId : viewer;
  const targetPlayer = game.players.find((player) => player.id === targetId)!;
  const ownCells = board === 'OWN' || revealAll ? fleetCellMap(targetPlayer.planes) : new Map<string, { planeId: string; kind: 'HEAD' | 'BODY' }>();
  const attacks = attackMap(attacker);
  const revealed = new Map<string, 'HEAD' | 'BODY'>();
  if (board === 'ENEMY' && (revealDestroyedPlane || revealAll)) {
    for (const plane of targetPlayer.planes) {
      if (plane.destroyed || revealAll) for (const cell of planeCells(plane)) revealed.set(posKey(cell.position), cell.kind);
    }
  }
  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const key = posKey(position);
      const classes = ['cell'];
      const own = ownCells.get(key);
      const mark = attacks.get(key);
      const reveal = revealed.get(key);
      if (own) classes.push('plane', own.kind === 'HEAD' ? 'head' : 'body');
      if (mark === 'MISS') classes.push('miss');
      if (mark === 'HIT') classes.push('hit');
      if (mark === 'DESTROYED') classes.push('destroyed');
      if (reveal) classes.push('revealed', reveal === 'HEAD' ? 'revealed-head' : 'revealed-body');
      if (board === 'ENEMY' && selectedTarget && posKey(selectedTarget) === key) classes.push('selected');
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coord(position)}" ${interactive ? '' : 'tabindex="-1"'}></button>`;
    }
  }
  return `${html}</div>`;
}

function ensureFleet(player: LocalPlayerId): void {
  if (fleets[player].length !== 3) fleets[player] = createPlacementFleet(player.toLowerCase());
}

function renderSetup(): void {
  app.innerHTML = shell(`<section class="panel online-home"><div class="online-hero"><div class="handoff-icon">🎮</div><h2>本地双人</h2><p class="subtle">两位玩家在同一台设备轮流部署、攻击。每次换人都有隐私遮罩。</p></div><div class="rule-choice"><label class="rule-option ${revealDestroyedPlane ? 'active' : ''}"><input type="radio" name="reveal" value="yes" ${revealDestroyedPlane ? 'checked' : ''}><strong>击落后显示完整轮廓</strong><span>击中机头后公开该飞机完整 10 格轮廓。</span></label><label class="rule-option ${!revealDestroyedPlane ? 'active' : ''}"><input type="radio" name="reveal" value="no" ${!revealDestroyedPlane ? 'checked' : ''}><strong>击落后不显示轮廓</strong><span>只显示击落机头 ✹ 与已知攻击标记。</span></label></div><div class="controls room-controls">${button('开始部署', 'start-local', 'action primary')}</div></section>`, '规则设置');
  document.querySelectorAll<HTMLInputElement>('input[name="reveal"]').forEach((input) => input.addEventListener('change', () => { revealDestroyedPlane = input.value === 'yes'; render(); }));
  document.querySelector('#start-local')?.addEventListener('click', () => {
    fleets = { A: createPlacementFleet('a'), B: [] };
    flow = { stage: 'PLACEMENT_A' };
    selectedPlaneId = fleets.A[0].id;
    message = '拖动整架飞机调整位置；选中飞机后可旋转。';
    render();
  });
}

function renderPlacement(player: LocalPlayerId): void {
  ensureFleet(player);
  const fleet = fleets[player];
  const ready = fleet.length === 3 && validatePlacement(fleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-title"><strong>玩家 ${player} · 部署战机</strong><span>拖拽整架飞机</span></div>${placementBoard(player)}<div class="legend"><span><i class="dot"></i> 战机</span><span>蓝框 = 当前选择</span><span>红色 = 非法位置</span></div></div><aside class="sidebar"><div class="card"><h3>操作</h3><p class="subtle">按住飞机任意格拖动；点击选中后旋转 90°。</p></div><div class="card status">${escapeHtml(message)}</div><div class="controls">${button('旋转选中飞机 ↻', 'rotate-plane', 'action', !selectedPlaneId)}${button('随机重新摆放', 'random-fleet')}${button('部署完成', 'confirm-placement', 'action primary', !ready)}</div></aside></section>`, `玩家 ${player} 部署`);
  document.querySelectorAll<HTMLButtonElement>('#placement-board .cell').forEach((cell) => cell.addEventListener('pointerdown', (event) => {
    const position = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const plane = planeAt(fleets[player], position);
    if (!plane) return;
    event.preventDefault();
    selectedPlaneId = plane.id;
    drag = { player, planeId: plane.id, grabbed: position };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    render();
  }));
  document.querySelector('#rotate-plane')?.addEventListener('click', () => {
    if (!selectedPlaneId) return;
    const result = rotateCandidate(fleets[player], selectedPlaneId);
    if (result.valid) { fleets[player] = result.fleet; message = '已旋转选中飞机。'; }
    else message = '该方向会出界或与其他飞机重叠，已保持原方向。';
    render();
  });
  document.querySelector('#random-fleet')?.addEventListener('click', () => { fleets[player] = createPlacementFleet(player.toLowerCase()); selectedPlaneId = fleets[player][0].id; message = '已生成新的合法随机布局。'; render(); });
  document.querySelector('#confirm-placement')?.addEventListener('click', () => {
    if (!ready) return;
    if (flow.stage !== 'PLACEMENT_A' && flow.stage !== 'PLACEMENT_B') return;
    flow = confirmPlacement(flow);
    selectedPlaneId = null;
    drag = null;
    render();
  });
}

function renderHandoff(player: LocalPlayerId, title: string, detail: string, action: string, onContinue: () => void): void {
  app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">🔒</div><h2>${escapeHtml(title)}</h2><p class="subtle">${escapeHtml(detail)}</p>${button(action, 'handoff-continue', 'action primary')}</div></section>`, '隐私交接');
  document.querySelector('#handoff-continue')?.addEventListener('click', onContinue);
}

function destroyedCount(player: LocalPlayerId): number {
  return game?.players.find((item) => item.id === player)?.planes.filter((plane) => plane.destroyed).length ?? 0;
}

function renderBattle(activePlayer: LocalPlayerId, resultMode = false): void {
  if (!game) return;
  const enemy = other(activePlayer);
  const interactive = !resultMode && activeBoard === 'ENEMY';
  const targetLabel = selectedTarget ? coord(selectedTarget) : '未选择';
  const alreadyUsed = selectedTarget ? game.attacks.some((record) => record.attackerId === activePlayer && posKey(record.position) === posKey(selectedTarget!)) : false;
  const resultPanel = resultMode
    ? `<div class="card turn-result-card"><h3>攻击结果</h3><div class="turn-result-text">${escapeHtml(lastAttackText)}</div></div><div class="controls">${button('结束回合', 'end-turn', 'action primary')}</div>`
    : `<div class="card"><h3>玩家 ${activePlayer} 的回合</h3><div class="statline"><span>目标</span><b>${targetLabel}</b></div><div class="statline"><span>敌机击落</span><b>${destroyedCount(enemy)}/3</b></div></div><div class="card status">${escapeHtml(message || '选择敌方一个未攻击坐标。')}</div><div class="controls">${button(selectedTarget ? `攻击 ${targetLabel}` : '请选择目标', 'fire', 'action primary', !selectedTarget || alreadyUsed || activeBoard !== 'ENEMY')}</div>`;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-tabs"><button class="tab ${activeBoard === 'ENEMY' ? 'active' : ''}" data-board="ENEMY">敌方战场</button><button class="tab ${activeBoard === 'OWN' ? 'active' : ''}" data-board="OWN">我的战场</button></div><div class="board-title"><strong>${activeBoard === 'ENEMY' ? `玩家 ${enemy} 战场` : `玩家 ${activePlayer} 战场`}</strong><span>${activeBoard === 'ENEMY' ? `已击落 ${destroyedCount(enemy)}/3` : `已损失 ${destroyedCount(activePlayer)}/3`}</span></div>${battleBoardHtml(activePlayer, activeBoard, interactive)}<div class="legend"><span class="legend-mark miss-mark">○ 未命中</span><span class="legend-mark hit-mark">× 命中</span><span class="legend-mark destroyed-mark">✹ 击落</span></div></div><aside class="sidebar">${resultPanel}</aside></section>`, resultMode ? '结果确认' : `玩家 ${activePlayer} 回合`);
  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((tab) => tab.addEventListener('click', () => { activeBoard = tab.dataset.board as BattleBoard; selectedTarget = null; render(); }));
  if (interactive) {
    document.querySelectorAll<HTMLButtonElement>('.board .cell').forEach((cell) => cell.addEventListener('click', () => {
      selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
      const used = game?.attacks.some((record) => record.attackerId === activePlayer && posKey(record.position) === posKey(selectedTarget!));
      message = used ? `${coord(selectedTarget)} 已攻击过。` : `已选择 ${coord(selectedTarget)}，点击攻击按钮确认。`;
      render();
    }));
    document.querySelector('#fire')?.addEventListener('click', () => {
      if (!game || !selectedTarget || flow.stage !== 'PLAYING') return;
      try {
        const target = { ...selectedTarget };
        const outcome = attack(game, target);
        game = outcome.game;
        lastAttackText = outcome.result.kind === 'MISS' ? `${coord(target)} · 未命中 ○` : outcome.result.kind === 'HIT' ? `${coord(target)} · 命中机身 ×` : `${coord(target)} · 击中机头，击落 ✹`;
        selectedTarget = null;
        const next = game.currentPlayerId as LocalPlayerId;
        flow = recordAttackResult(flow, next, game.status === 'FINISHED');
        activeBoard = 'ENEMY';
        render();
      } catch (error) {
        message = error instanceof GameRuleError ? error.message : '攻击失败。';
        render();
      }
    });
  }
  document.querySelector('#end-turn')?.addEventListener('click', () => {
    if (flow.stage !== 'TURN_RESULT') return;
    flow = endTurn(flow);
    lastAttackText = '';
    message = '';
    render();
  });
}

function renderFinished(): void {
  if (!game?.winnerId) return;
  const winner = game.winnerId as LocalPlayerId;
  const winnerAttacks = game.attacks.filter((record) => record.attackerId === winner);
  const hits = winnerAttacks.filter((record) => record.kind !== 'MISS').length;
  app.innerHTML = shell(`<section class="panel result"><h2>玩家 ${winner} 胜利</h2><p class="subtle">双方完整布局已公开。</p><div class="result-grid"><div class="card">攻击次数<strong>${winnerAttacks.length}</strong></div><div class="card">有效命中<strong>${hits}</strong></div><div class="card">击落战机<strong>3</strong></div></div><div class="final-board-grid"><div><h3>玩家 A 最终战场</h3>${battleBoardHtml('A', 'OWN', false, true)}</div><div><h3>玩家 B 最终战场</h3>${battleBoardHtml('B', 'OWN', false, true)}</div></div><div class="controls room-controls">${button('再来一局', 'restart', 'action primary')}<a class="action-link" href="/">返回模式首页</a></div></section>`, '战斗结束');
  document.querySelector('#restart')?.addEventListener('click', () => { flow = beginLocalFlow(); fleets = { A: [], B: [] }; game = null; selectedPlaneId = null; selectedTarget = null; activeBoard = 'ENEMY'; message = ''; lastAttackText = ''; render(); });
}

function render(): void {
  switch (flow.stage) {
    case 'SETUP': return renderSetup();
    case 'PLACEMENT_A': return renderPlacement('A');
    case 'HANDOFF_B': return renderHandoff('B', '请交给玩家 B', '玩家 A 的布局已经隐藏。', '开始我的部署', () => { if (flow.stage === 'HANDOFF_B') { flow = startSecondPlacement(flow); fleets.B = createPlacementFleet('b'); selectedPlaneId = fleets.B[0].id; message = '拖动整架飞机调整位置；选中飞机后可旋转。'; render(); } });
    case 'PLACEMENT_B': return renderPlacement('B');
    case 'HANDOFF_BATTLE': return renderHandoff('A', '双方部署完成', '下一步随机决定先手，确认屏幕旁只有当前玩家。', '随机先手并开始', () => { if (flow.stage === 'HANDOFF_BATTLE') { game = createGame([{ id: 'A', planes: fleets.A }, { id: 'B', planes: fleets.B }], undefined, { revealDestroyedPlane }); flow = startBattle(flow, game.currentPlayerId as LocalPlayerId); render(); } });
    case 'HANDOFF_TURN': return renderHandoff(flow.nextPlayer, `请交给玩家 ${flow.nextPlayer}`, '上一位玩家的战场与攻击结果已隐藏。', '开始我的回合', () => { if (flow.stage === 'HANDOFF_TURN') { flow = openTurn(flow); activeBoard = 'ENEMY'; selectedTarget = null; message = '请选择一个未攻击坐标。'; render(); } });
    case 'PLAYING': return renderBattle(flow.activePlayer, false);
    case 'TURN_RESULT': return renderBattle(flow.activePlayer, true);
    case 'FINISHED': return renderFinished();
  }
}

window.addEventListener('pointermove', (event) => {
  if (!drag || (flow.stage !== 'PLACEMENT_A' && flow.stage !== 'PLACEMENT_B')) return;
  const board = document.querySelector<HTMLElement>('#placement-board');
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * 10);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * 10);
  if (x < 0 || x > 9 || y < 0 || y > 9) return;
  const nextPreview = dragCandidate(fleets[drag.player], drag.planeId, drag.grabbed, { x, y });
  const current = drag.preview?.fleet.find((plane) => plane.id === drag!.planeId)?.head;
  const next = nextPreview.fleet.find((plane) => plane.id === drag!.planeId)?.head;
  if (current?.x === next?.x && current?.y === next?.y && drag.preview?.valid === nextPreview.valid) return;
  drag.preview = nextPreview;
  render();
});

window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.preview?.valid) {
    fleets[drag.player] = drag.preview.fleet;
    message = '飞机位置已更新。';
  } else if (drag.preview) {
    message = '该位置出界或重叠，已恢复原位置。';
  }
  drag = null;
  render();
});

render();
