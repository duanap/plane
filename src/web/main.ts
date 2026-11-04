import { attack, createGame, GameRuleError, type GameState } from '../game/game.ts';
import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Plane, Position } from '../game/types.ts';
import { defaultFleet } from '../game/fleet-placement.ts';
import { bindFleetEditor, fleetBoard, fleetTools } from './fleet-editor.ts';
import { boardFrame } from './board.ts';
import { AttackResultDelay, attackMessage, attackResultHtml, type AttackFeedback } from './attack-result.ts';
import { actionLabel, uiIcon } from './neon-ui.ts';

type Stage = 'PLACEMENT_A' | 'HANDOFF_B' | 'PLACEMENT_B' | 'HANDOFF_BATTLE' | 'PLAYING' | 'ATTACK_RESULT' | 'HANDOFF_TURN' | 'FINISHED';

const app = document.querySelector<HTMLDivElement>('#app')!;
if (!app) throw new Error('Missing #app');

let stage: Stage = 'PLACEMENT_A';
let fleets: Record<'A' | 'B', Plane[]> = { A: defaultFleet('a'), B: defaultFleet('b') };
let placementHistory: Record<'A' | 'B', Plane[][]> = { A: [], B: [] };
let selectedPlane: Record<'A' | 'B', string> = { A: 'a1', B: 'b1' };
let selectedTarget: Position | null = null;
let game: GameState | null = null;
let lastMessage = '已摆好 3 架飞机，拖动调整位置，点击飞机旋转。';
let nextHandoffPlayer: 'A' | 'B' = 'A';
let attackFeedback: AttackFeedback | null = null;
const resultDelay = new AttackResultDelay();

function posKey(position: Position): string { return `${position.x}:${position.y}`; }
function coord(position: Position): string { return `${String.fromCharCode(65 + position.y)}${position.x + 1}`; }
function currentPlacementPlayer(): 'A' | 'B' { return stage === 'PLACEMENT_A' ? 'A' : 'B'; }

function button(label: string, id: string, className = 'action', disabled = false): string {
  return `<button type="button" class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${actionLabel(label, id)}</button>`;
}

function boardHtml(options: { ownPlanes?: Plane[]; attackViewFor?: 'A' | 'B'; interactive?: boolean }): string {
  const ownCells = new Map<string, 'HEAD' | 'BODY'>();
  for (const plane of options.ownPlanes ?? []) {
    for (const cell of planeCells(plane)) ownCells.set(posKey(cell.position), cell.kind);
  }

  const attacks = game && options.attackViewFor
    ? game.attacks.filter((record) => record.attackerId === options.attackViewFor)
    : [];
  const attackMap = new Map(attacks.map((record) => [posKey(record.position), record.kind]));
  const targetPlayer = game && options.attackViewFor ? game.players.find((player) => player.id !== options.attackViewFor) : undefined;
  const revealed = new Set<string>();
  for (const plane of targetPlayer?.planes ?? []) {
    if (plane.destroyed) for (const cell of planeCells(plane)) revealed.add(posKey(cell.position));
  }

  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const key = posKey(position);
      const classes = ['cell'];
      const ownKind = ownCells.get(key);
      const result = attackMap.get(key);
      if (ownKind) classes.push('plane', ownKind === 'HEAD' ? 'head' : 'body');
      if (result === 'MISS') classes.push('miss');
      if (result === 'HIT') classes.push('hit');
      if (result === 'DESTROYED') classes.push('destroyed');
      if (revealed.has(key)) classes.push('revealed');
      if (selectedTarget && selectedTarget.x === x && selectedTarget.y === y) classes.push('selected');
      if (attackFeedback && attackFeedback.position.x === x && attackFeedback.position.y === y) classes.push('last-attack');
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coord(position)}" aria-label="${coord(position)}" ${options.interactive ? '' : 'tabindex="-1"'}></button>`;
    }
  }
  html += '</div>';
  return boardFrame(html, attackFeedback ? attackResultHtml(attackFeedback, game?.status === 'FINISHED' ? '即将显示对局结果' : `即将进入玩家 ${nextHandoffPlayer} 的回合`) : '');
}

function shell(content: string, badge: string): string {
  return `<div class="shell play-shell"><header class="topbar"><div class="brand"><h1>${uiIcon('plane')}炸飞机 <small>PLANE</small></h1><p>本地双人 · 同一设备轮流对战</p></div><div class="top-actions"><span class="badge ${badge.includes('部署') ? 'badge-deployment' : ''}">${badge}</span><a class="text-link" href="/online.html">在线对战</a><a class="text-link" href="/">返回首页</a></div></header>${content}</div>`;
}

function renderPlacement(): void {
  const player = currentPlacementPlayer();
  const fleet = fleets[player];
  const ready = fleet.length === 3 && validatePlacement(fleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout deployment-layout">
    <div class="board-wrap">
      <div class="board-title"><div><span class="eyebrow">DEPLOYMENT / 玩家 ${player}</span><strong>部署你的编队</strong></div><span class="board-hint">拖动移动 · 点击旋转</span></div>
      ${fleetBoard(fleet, selectedPlane[player])}
      <div class="board-footer"><span><i class="dot"></i> 数字标记为机头</span><span>仅玩家 ${player} 可见</span></div>
    </div>
    <aside class="sidebar">
      <div class="phase-card"><span class="phase-indicator"></span><div><strong>玩家 ${player} 布阵中</strong><p>藏好机头，再交给对方。</p></div></div>
      ${fleetTools(fleet, selectedPlane[player], placementHistory[player].length > 0)}
      <div class="status placement-status" role="status" aria-live="polite">${lastMessage}</div>
      <div class="controls primary-controls">${button(ready ? '确认布阵 · 下一步 →' : '请先消除飞机重叠', 'ready', 'action primary', !ready)}</div>
    </aside>
  </section>`, `玩家 ${player} 部署阶段`);
  const updateFleet = (next: Plane[]) => { placementHistory[player].push(fleets[player]); fleets[player] = next; render(); };
  bindFleetEditor({ fleet, selectedId: selectedPlane[player], onSelect: (id) => { selectedPlane[player] = id; }, onChange: updateFleet, onMessage: (message) => {
    lastMessage = message;
    const status = document.querySelector('.placement-status');
    if (status) status.textContent = message;
  } });
  document.querySelector('#random')?.addEventListener('click', () => { lastMessage = '已生成新的随机布局。'; updateFleet(randomFleet(player.toLowerCase())); });
  document.querySelector('#undo-placement')?.addEventListener('click', () => { const previous = placementHistory[player].pop(); if (previous) fleets[player] = previous; lastMessage = '已撤销上一次调整。'; render(); });
  document.querySelector('#reset')?.addEventListener('click', () => { lastMessage = '已恢复初始编队。'; updateFleet(defaultFleet(player.toLowerCase())); });
  document.querySelector('#ready')?.addEventListener('click', () => {
    if (!ready) return;
    if (player === 'A') { stage = 'HANDOFF_B'; lastMessage = '轮到玩家 B 部署。'; }
    else { stage = 'HANDOFF_BATTLE'; lastMessage = '双方部署完成。'; }
    render();
  });
}

function renderHandoff(player: 'A' | 'B', message: string, actionLabel: string, next: () => void): void {
  app.innerHTML = shell(`<section class="panel handoff"><div class="handoff-inner"><div class="handoff-icon">✈️</div><h2>交给玩家 ${player}</h2><p class="subtle">${message}</p>${button(actionLabel, 'continue', 'action primary')}</div></section>`, '隐私交接');
  document.querySelector('#continue')?.addEventListener('click', next);
}

function destroyedCount(targetId: 'A' | 'B'): number {
  if (!game) return 0;
  return game.players.find((p) => p.id === targetId)?.planes.filter((p) => p.destroyed).length ?? 0;
}

function renderBattle(): void {
  if (!game) return;
  const showingResult = stage === 'ATTACK_RESULT' && attackFeedback !== null;
  const attacker = (showingResult ? attackFeedback!.attackerId : game.currentPlayerId) as 'A' | 'B';
  const defender = attacker === 'A' ? 'B' : 'A';
  const target = showingResult ? attackFeedback!.position : selectedTarget;
  const alreadyAttacked = target ? game.attacks.some((r) => r.attackerId === attacker && posKey(r.position) === posKey(target)) : false;
  const targetLabel = target ? coord(target) : '未选择';

  app.innerHTML = shell(`<section class="panel game-layout battle-layout">
    <div class="board-wrap">
      <div class="board-title"><div><span class="eyebrow">BATTLE / 玩家 ${attacker}</span><strong>敌方战场 · 玩家 ${defender}</strong></div><span>已击落 ${destroyedCount(defender)}/3</span></div>
      ${boardHtml({ attackViewFor: attacker, interactive: !showingResult })}
      <div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击落机头</span></div>
    </div>
    <aside class="sidebar">
      <div class="phase-card"><span class="phase-indicator"></span><div><strong>${showingResult ? '攻击结果' : `玩家 ${attacker} 的回合`}</strong><p>${showingResult ? '查看落点反馈后自动继续。' : '选择坐标，再确认攻击。'}</p></div></div>
      <div class="target-card"><span>${showingResult ? '本次攻击坐标' : '已锁定坐标'}</span><strong>${targetLabel === '未选择' ? '—' : targetLabel}</strong><span>已攻击 ${game.attacks.filter((r) => r.attackerId === attacker).length} 次 · 损失 ${destroyedCount(attacker)}/3 架</span></div>
      <div class="status" role="status">${lastMessage}</div>
      <div class="controls primary-controls">${button(showingResult ? '正在显示攻击结果…' : selectedTarget ? `确认攻击 ${targetLabel} →` : '先在地图上选择目标', 'fire', 'action primary', showingResult || !selectedTarget || Boolean(alreadyAttacked))}</div>
    </aside>
  </section>`, showingResult ? '攻击结果' : `玩家 ${attacker} 回合`);

  if (showingResult) return;

  document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
    selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const used = game?.attacks.some((r) => r.attackerId === attacker && posKey(r.position) === posKey(selectedTarget!));
    lastMessage = used ? `${coord(selectedTarget)} 已经攻击过，请选择其他坐标。` : `已锁定 ${coord(selectedTarget)}，再次点击攻击按钮确认。`;
    render();
  }));
  document.querySelector('#fire')?.addEventListener('click', () => {
    if (!game || !selectedTarget || stage !== 'PLAYING') return;
    try {
      const outcome = attack(game, selectedTarget);
      game = outcome.game;
      attackFeedback = game.attacks.at(-1)!;
      lastMessage = attackMessage(attackFeedback);
      selectedTarget = null;
      nextHandoffPlayer = game.currentPlayerId as 'A' | 'B';
      stage = 'ATTACK_RESULT';
      render();
      resultDelay.show(String(game.attacks.length), () => {
        attackFeedback = null;
        stage = game?.status === 'FINISHED' ? 'FINISHED' : 'HANDOFF_TURN';
        render();
      });
    } catch (error) {
      lastMessage = error instanceof GameRuleError ? error.message : '攻击失败。'; render();
    }
  });
}

function renderFinished(): void {
  if (!game) return;
  const winner = game.winnerId as 'A' | 'B';
  const winnerAttacks = game.attacks.filter((a) => a.attackerId === winner);
  const hits = winnerAttacks.filter((a) => a.kind !== 'MISS').length;
  app.innerHTML = shell(`<section class="panel result"><h2>玩家 ${winner} 胜利</h2><p class="subtle">成功击落对方全部 3 架战机</p><div class="result-grid"><div class="card">攻击次数<strong>${winnerAttacks.length}</strong></div><div class="card">命中次数<strong>${hits}</strong></div><div class="card">击落战机<strong>3</strong></div></div><div class="controls" style="max-width:360px;margin:0 auto">${button('再来一局', 'restart', 'action primary')}</div></section>`, '战斗结束');
  document.querySelector('#restart')?.addEventListener('click', () => {
    resultDelay.clear(); attackFeedback = null;
    stage = 'PLACEMENT_A'; fleets = { A: defaultFleet('a'), B: defaultFleet('b') }; placementHistory = { A: [], B: [] }; selectedPlane = { A: 'a1', B: 'b1' }; game = null; selectedTarget = null; lastMessage = '已摆好 3 架飞机，拖动调整位置，点击飞机旋转。'; render();
  });
}

function render(): void {
  if (stage === 'PLACEMENT_A' || stage === 'PLACEMENT_B') return renderPlacement();
  if (stage === 'HANDOFF_B') return renderHandoff('B', '玩家 A 的布局已隐藏。确认屏幕只由玩家 B 查看后继续。', '开始部署', () => { stage = 'PLACEMENT_B'; lastMessage = '已摆好 3 架飞机，拖动调整位置，点击飞机旋转。'; render(); });
  if (stage === 'HANDOFF_BATTLE') return renderHandoff('A', '双方布局已锁定。下一屏将开始战斗并随机决定先手。', '开始战斗', () => { game = createGame([{ id: 'A', planes: fleets.A }, { id: 'B', planes: fleets.B }]); nextHandoffPlayer = game.currentPlayerId as 'A' | 'B'; stage = 'HANDOFF_TURN'; render(); });
  if (stage === 'HANDOFF_TURN') return renderHandoff(nextHandoffPlayer, lastMessage, '查看战场', () => { lastMessage = '请选择一个未攻击坐标。'; stage = 'PLAYING'; render(); });
  if (stage === 'PLAYING' || stage === 'ATTACK_RESULT') return renderBattle();
  renderFinished();
}

render();
