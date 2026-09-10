import { attack, createGame, GameRuleError, type GameState } from '../game/game.ts';
import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Direction, Plane, Position } from '../game/types.ts';

type Stage = 'PLACEMENT_A' | 'HANDOFF_B' | 'PLACEMENT_B' | 'HANDOFF_BATTLE' | 'PLAYING' | 'HANDOFF_TURN' | 'FINISHED';

const app = document.querySelector<HTMLDivElement>('#app')!;
if (!app) throw new Error('Missing #app');

let stage: Stage = 'PLACEMENT_A';
let fleets: Record<'A' | 'B', Plane[]> = { A: [], B: [] };
let placementDirection: Direction = 'UP';
let selectedTarget: Position | null = null;
let game: GameState | null = null;
let lastMessage = '点击棋盘选择机头位置。';
let nextHandoffPlayer: 'A' | 'B' = 'A';

const directions: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const directionText: Record<Direction, string> = { UP: '↑ 向上', RIGHT: '→ 向右', DOWN: '↓ 向下', LEFT: '← 向左' };

function posKey(position: Position): string { return `${position.x}:${position.y}`; }
function coord(position: Position): string { return `${String.fromCharCode(65 + position.y)}${position.x + 1}`; }
function currentPlacementPlayer(): 'A' | 'B' { return stage === 'PLACEMENT_A' ? 'A' : 'B'; }

function button(label: string, id: string, className = 'action', disabled = false): string {
  return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`;
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
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coord(position)}" aria-label="${coord(position)}" ${options.interactive ? '' : 'tabindex="-1"'}></button>`;
    }
  }
  html += '</div>';
  return html;
}

function shell(content: string, badge: string): string {
  return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>10×10 坐标推理对战</p></div><div class="badge">${badge}</div></header>${content}</div>`;
}

function renderPlacement(): void {
  const player = currentPlacementPlayer();
  const fleet = fleets[player];
  const ready = fleet.length === 3 && validatePlacement(fleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout">
    <div class="board-wrap">
      <div class="board-title"><strong>玩家 ${player} · 部署战机</strong><span>${fleet.length}/3 架</span></div>
      ${boardHtml({ ownPlanes: fleet, interactive: true })}
      <div class="legend" style="margin-top:12px"><span><i class="dot"></i> 已部署战机</span><span>机头坐标 + 方向决定整架飞机</span></div>
    </div>
    <aside class="sidebar">
      <div class="card"><h3>当前方向</h3><div style="font-size:26px">${directionText[placementDirection]}</div></div>
      <div class="card status">${lastMessage}</div>
      <div class="controls">
        ${button('旋转战机 ↻', 'rotate')}
        ${button('随机摆放 3 架', 'random')}
        ${button('撤销最后一架', 'undo', 'action', fleet.length === 0)}
        ${button('重新摆放', 'reset', 'action danger', fleet.length === 0)}
        ${button('准备完成', 'ready', 'action primary', !ready)}
      </div>
    </aside>
  </section>`, `玩家 ${player} 部署阶段`);

  document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
    if (fleet.length >= 3) { lastMessage = '已经摆满 3 架飞机，可撤销或直接准备。'; render(); return; }
    const candidate: Plane = { id: `${player.toLowerCase()}${fleet.length + 1}`, head: { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }, direction: placementDirection, destroyed: false };
    const validation = validatePlacement([...fleet, candidate]);
    if (!validation.valid) {
      lastMessage = validation.reason === 'OUT_OF_BOUNDS' ? '该位置会让飞机超出战场。' : '该位置与已有飞机重叠。';
    } else {
      fleets[player] = [...fleet, candidate];
      lastMessage = `已部署第 ${fleet.length + 1} 架，机头 ${coord(candidate.head)}。`;
    }
    render();
  }));
  document.querySelector('#rotate')?.addEventListener('click', () => { placementDirection = directions[(directions.indexOf(placementDirection) + 1) % directions.length]; render(); });
  document.querySelector('#random')?.addEventListener('click', () => { fleets[player] = randomFleet(player.toLowerCase()); lastMessage = '已生成合法随机布局，可继续调整或准备。'; render(); });
  document.querySelector('#undo')?.addEventListener('click', () => { fleets[player] = fleet.slice(0, -1); lastMessage = '已撤销最后一架飞机。'; render(); });
  document.querySelector('#reset')?.addEventListener('click', () => { fleets[player] = []; lastMessage = '布局已清空。'; render(); });
  document.querySelector('#ready')?.addEventListener('click', () => {
    if (player === 'A') { stage = 'HANDOFF_B'; lastMessage = '轮到玩家 B 部署。'; }
    else { stage = 'HANDOFF_BATTLE'; lastMessage = '双方部署完成。'; }
    placementDirection = 'UP'; render();
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
  const attacker = game.currentPlayerId as 'A' | 'B';
  const defender = attacker === 'A' ? 'B' : 'A';
  const target = selectedTarget;
  const alreadyAttacked = target ? game.attacks.some((r) => r.attackerId === attacker && posKey(r.position) === posKey(target)) : false;
  const targetLabel = target ? coord(target) : '未选择';

  app.innerHTML = shell(`<section class="panel game-layout">
    <div class="board-wrap">
      <div class="board-title"><strong>敌方战场 · 玩家 ${defender}</strong><span>敌机已击落 ${destroyedCount(defender)}/3</span></div>
      ${boardHtml({ attackViewFor: attacker, interactive: true })}
      <div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击落机头</span></div>
    </div>
    <aside class="sidebar">
      <div class="card"><h3>玩家 ${attacker} 的回合</h3><div class="statline"><span>目标坐标</span><b>${targetLabel}</b></div><div class="statline"><span>已攻击</span><b>${game.attacks.filter((r) => r.attackerId === attacker).length} 次</b></div></div>
      <div class="card status">${lastMessage}</div>
      <div class="controls">${button(selectedTarget ? `攻击 ${targetLabel}` : '请选择目标', 'fire', 'action primary', !selectedTarget || Boolean(alreadyAttacked))}</div>
    </aside>
  </section>`, `玩家 ${attacker} 回合`);

  document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
    selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const used = game?.attacks.some((r) => r.attackerId === attacker && posKey(r.position) === posKey(selectedTarget!));
    lastMessage = used ? `${coord(selectedTarget)} 已经攻击过，请选择其他坐标。` : `已锁定 ${coord(selectedTarget)}，再次点击攻击按钮确认。`;
    render();
  }));
  document.querySelector('#fire')?.addEventListener('click', () => {
    if (!game || !selectedTarget) return;
    try {
      const outcome = attack(game, selectedTarget);
      game = outcome.game;
      lastMessage = outcome.result.kind === 'MISS' ? `${targetLabel}：未命中。` : outcome.result.kind === 'HIT' ? `${targetLabel}：命中机身！` : `${targetLabel}：击中机头，敌机被击落！`;
      selectedTarget = null;
      if (game.status === 'FINISHED') stage = 'FINISHED';
      else { nextHandoffPlayer = game.currentPlayerId as 'A' | 'B'; stage = 'HANDOFF_TURN'; }
      render();
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
    stage = 'PLACEMENT_A'; fleets = { A: [], B: [] }; game = null; selectedTarget = null; placementDirection = 'UP'; lastMessage = '点击棋盘选择机头位置。'; render();
  });
}

function render(): void {
  if (stage === 'PLACEMENT_A' || stage === 'PLACEMENT_B') return renderPlacement();
  if (stage === 'HANDOFF_B') return renderHandoff('B', '玩家 A 的布局已隐藏。确认屏幕只由玩家 B 查看后继续。', '开始部署', () => { stage = 'PLACEMENT_B'; render(); });
  if (stage === 'HANDOFF_BATTLE') return renderHandoff('A', '双方布局已锁定。下一屏将开始战斗并随机决定先手。', '开始战斗', () => { game = createGame([{ id: 'A', planes: fleets.A }, { id: 'B', planes: fleets.B }]); nextHandoffPlayer = game.currentPlayerId as 'A' | 'B'; stage = 'HANDOFF_TURN'; render(); });
  if (stage === 'HANDOFF_TURN') return renderHandoff(nextHandoffPlayer, lastMessage, '查看战场', () => { lastMessage = '请选择一个未攻击坐标。'; stage = 'PLAYING'; render(); });
  if (stage === 'PLAYING') return renderBattle();
  renderFinished();
}

render();
