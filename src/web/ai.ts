import { planeCells, validatePlacement } from '../game/geometry.ts';
import type { AttackKind, GameState } from '../game/game.ts';
import type { Plane, PlaneCell, Position } from '../game/types.ts';
import { createAiSession, humanAttack, runAiTurn, type AiSessionState } from '../ai/session.ts';
import type { AiDifficulty } from '../ai/ai.ts';
import { createPlacementFleet, dragCandidate, planeAt, rotateCandidate, type PlacementCandidate } from './placement-model.ts';

type Stage = 'SETTINGS' | 'PLACEMENT' | 'PLAYING' | 'FINISHED';
type BattleBoard = 'ENEMY' | 'OWN';
type DragState = { planeId: string; grabbed: Position; preview?: PlacementCandidate };

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

let stage: Stage = 'SETTINGS';
let difficulty: AiDifficulty = 'NORMAL';
let revealDestroyedPlane = true;
let humanFleet: Plane[] = [];
let selectedPlaneId: string | null = null;
let selectedTarget: Position | null = null;
let session: AiSessionState | null = null;
let activeBattleBoard: BattleBoard = 'ENEMY';
let drag: DragState | null = null;
let message = '选择难度与本局击落显示规则。';
let aiTurnScheduled = false;

const difficultyText: Record<AiDifficulty, string> = { EASY: '简单', NORMAL: '普通', HARD: '困难' };
function posKey(position: Position): string { return `${position.x}:${position.y}`; }
function coord(position: Position): string { return `${String.fromCharCode(65 + position.y)}${position.x + 1}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!); }
function button(label: string, id: string, className = 'action', disabled = false): string { return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`; }
function shell(content: string, badge: string): string {
  return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>AI 练习 · AI 只读取公开攻击结果</p></div><div class="top-actions"><a class="text-link" href="/">模式首页</a><a class="text-link" href="/online.html">在线对战</a><span class="badge">${escapeHtml(badge)}</span></div></header>${content}</div>`;
}

function planeCellMap(planes: Plane[]): Map<string, PlaneCell> {
  const result = new Map<string, PlaneCell>();
  for (const plane of planes) for (const cell of planeCells(plane)) result.set(posKey(cell.position), cell);
  return result;
}
function attackMap(game: GameState, attackerId: 'HUMAN' | 'AI'): Map<string, AttackKind> {
  return new Map(game.attacks.filter((record) => record.attackerId === attackerId).map((record) => [posKey(record.position), record.kind]));
}

function placementBoard(): string {
  const candidate = drag?.preview ?? null;
  const fleet = candidate?.fleet ?? humanFleet;
  const map = planeCellMap(fleet);
  const invalidPlaneId = candidate && !candidate.valid ? drag?.planeId : null;
  let html = '<div class="board placement-board" id="ai-placement-board">';
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) {
    const position = { x, y };
    const cell = map.get(posKey(position));
    const classes = ['cell'];
    if (cell) {
      classes.push('plane', cell.kind === 'HEAD' ? 'head' : 'body');
      if (cell.planeId === selectedPlaneId) classes.push('plane-selected');
      if (cell.planeId === invalidPlaneId) classes.push('invalid');
    }
    html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coord(position)}"></button>`;
  }
  return `${html}</div>`;
}

function boardHtml(options: { ownPlanes?: Plane[]; attackViewFor?: 'HUMAN' | 'AI'; interactive?: boolean; revealAllEnemy?: boolean }): string {
  const game = session?.game;
  const own = planeCellMap(options.ownPlanes ?? []);
  const attacks = game && options.attackViewFor ? attackMap(game, options.attackViewFor) : new Map<string, AttackKind>();
  const opponent = game && options.attackViewFor ? game.players.find((player) => player.id !== options.attackViewFor) : undefined;
  const revealed = new Map<string, PlaneCell>();
  if (opponent) {
    for (const plane of opponent.planes) {
      if (options.revealAllEnemy || (revealDestroyedPlane && plane.destroyed)) for (const cell of planeCells(plane)) revealed.set(posKey(cell.position), cell);
    }
  }
  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) {
    const position = { x, y };
    const key = posKey(position);
    const classes = ['cell'];
    const ownCell = own.get(key);
    const mark = attacks.get(key);
    const revealedCell = revealed.get(key);
    if (ownCell) classes.push('plane', ownCell.kind === 'HEAD' ? 'head' : 'body');
    if (mark === 'MISS') classes.push('miss');
    if (mark === 'HIT') classes.push('hit');
    if (mark === 'DESTROYED') classes.push('destroyed');
    if (revealedCell) classes.push('revealed', revealedCell.kind === 'HEAD' ? 'revealed-head' : 'revealed-body');
    if (selectedTarget && options.attackViewFor === 'HUMAN' && posKey(selectedTarget) === key) classes.push('selected');
    html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${coord(position)}" ${options.interactive ? '' : 'tabindex="-1"'}></button>`;
  }
  return `${html}</div>`;
}

function renderSettings(): void {
  app.innerHTML = shell(`<section class="panel online-home"><div class="online-hero"><h2>AI 练习设置</h2><p class="subtle">三档 AI 都不会读取你的隐藏布局。</p></div><div class="difficulty-grid"><button class="difficulty-card ${difficulty === 'EASY' ? 'featured' : ''}" data-difficulty="EASY"><strong>简单</strong><span>随机攻击未尝试坐标。</span></button><button class="difficulty-card ${difficulty === 'NORMAL' ? 'featured' : ''}" data-difficulty="NORMAL"><strong>普通</strong><span>命中后追踪附近格子。</span></button><button class="difficulty-card ${difficulty === 'HARD' ? 'featured' : ''}" data-difficulty="HARD"><strong>困难</strong><span>根据合法飞机形状推理。</span></button></div><div class="rule-choice"><label class="rule-option ${revealDestroyedPlane ? 'active' : ''}"><input type="radio" name="reveal" value="yes" ${revealDestroyedPlane ? 'checked' : ''}><strong>击落后显示完整轮廓</strong><span>击中机头后公开整架飞机。</span></label><label class="rule-option ${!revealDestroyedPlane ? 'active' : ''}"><input type="radio" name="reveal" value="no" ${!revealDestroyedPlane ? 'checked' : ''}><strong>击落后不显示轮廓</strong><span>只保留 ✹ 与已知攻击标记。</span></label></div><div class="controls room-controls">${button('开始部署', 'start-placement', 'action primary')}</div></section>`, '人机设置');
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((item) => item.addEventListener('click', () => { difficulty = item.dataset.difficulty as AiDifficulty; render(); }));
  document.querySelectorAll<HTMLInputElement>('input[name="reveal"]').forEach((item) => item.addEventListener('change', () => { revealDestroyedPlane = item.value === 'yes'; render(); }));
  document.querySelector('#start-placement')?.addEventListener('click', () => { humanFleet = createPlacementFleet('h'); selectedPlaneId = humanFleet[0].id; stage = 'PLACEMENT'; message = '拖动整架飞机调整位置；选中后可旋转。'; render(); });
}

function renderPlacement(): void {
  const legal = humanFleet.length === 3 && validatePlacement(humanFleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-title"><strong>部署你的战机</strong><span>${difficultyText[difficulty]} AI</span></div>${placementBoard()}<div class="legend"><span><i class="dot"></i> 战机</span><span>蓝框 = 当前选择</span><span>红色 = 非法位置</span></div></div><aside class="sidebar"><div class="card"><h3>本局规则</h3><div class="statline"><span>AI</span><b>${difficultyText[difficulty]}</b></div><div class="statline"><span>击落轮廓</span><b>${revealDestroyedPlane ? '显示' : '隐藏'}</b></div></div><div class="card status">${escapeHtml(message)}</div><div class="controls">${button('旋转选中飞机 ↻', 'rotate-plane', 'action', !selectedPlaneId)}${button('随机重新摆放', 'random-fleet')}${button('开始练习', 'start-game', 'action primary', !legal)}${button('返回设置', 'back-settings')}</div></aside></section>`, '部署阶段');
  document.querySelectorAll<HTMLButtonElement>('#ai-placement-board .cell').forEach((cell) => cell.addEventListener('pointerdown', (event) => {
    const position = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
    const plane = planeAt(humanFleet, position);
    if (!plane) return;
    event.preventDefault(); selectedPlaneId = plane.id; drag = { planeId: plane.id, grabbed: position }; render();
  }));
  document.querySelector('#rotate-plane')?.addEventListener('click', () => { if (!selectedPlaneId) return; const result = rotateCandidate(humanFleet, selectedPlaneId); if (result.valid) { humanFleet = result.fleet; message = '已旋转选中飞机。'; } else message = '该方向会出界或重叠，已保持原方向。'; render(); });
  document.querySelector('#random-fleet')?.addEventListener('click', () => { humanFleet = createPlacementFleet('h'); selectedPlaneId = humanFleet[0].id; message = '已生成新的合法随机布局。'; render(); });
  document.querySelector('#back-settings')?.addEventListener('click', () => { stage = 'SETTINGS'; render(); });
  document.querySelector('#start-game')?.addEventListener('click', () => { session = createAiSession(humanFleet, difficulty, { revealDestroyedPlane }); selectedTarget = null; activeBattleBoard = 'ENEMY'; stage = 'PLAYING'; message = session.game.currentPlayerId === 'HUMAN' ? '你获得先手，请选择攻击坐标。' : 'AI 获得先手，正在推理……'; render(); });
}

function destroyedCount(id: 'HUMAN' | 'AI'): number { return session?.game.players.find((p) => p.id === id)?.planes.filter((p) => p.destroyed).length ?? 0; }
function scheduleAiTurn(): void {
  if (!session || session.game.status !== 'PLAYING' || session.game.currentPlayerId !== 'AI' || aiTurnScheduled) return;
  aiTurnScheduled = true;
  window.setTimeout(() => {
    if (!session || session.game.status !== 'PLAYING' || session.game.currentPlayerId !== 'AI') { aiTurnScheduled = false; return; }
    const outcome = runAiTurn(session); session = outcome.session; aiTurnScheduled = false;
    message = `AI 攻击 ${coord(outcome.position)}：${outcome.result.kind === 'MISS' ? '未命中 ○' : outcome.result.kind === 'HIT' ? '命中机身 ×' : '击中机头 ✹'}。`;
    if (session.game.status === 'FINISHED') stage = 'FINISHED';
    render();
  }, 420);
}

function renderBattle(): void {
  if (!session) return;
  if (session.game.status === 'FINISHED') { stage = 'FINISHED'; return renderFinished(); }
  const humanTurn = session.game.currentPlayerId === 'HUMAN';
  const label = selectedTarget ? coord(selectedTarget) : '未选择';
  const used = selectedTarget ? session.game.attacks.some((r) => r.attackerId === 'HUMAN' && posKey(r.position) === posKey(selectedTarget!)) : false;
  const humanPlanes = session.game.players.find((p) => p.id === 'HUMAN')?.planes ?? [];
  const board = activeBattleBoard === 'OWN' ? boardHtml({ ownPlanes: humanPlanes, attackViewFor: 'AI' }) : boardHtml({ attackViewFor: 'HUMAN', interactive: humanTurn });
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-tabs"><button class="tab ${activeBattleBoard === 'ENEMY' ? 'active' : ''}" data-board="ENEMY">AI 战场</button><button class="tab ${activeBattleBoard === 'OWN' ? 'active' : ''}" data-board="OWN">我的战场</button></div><div class="board-title"><strong>${activeBattleBoard === 'ENEMY' ? 'AI 战场' : '我的战场'}</strong><span>${activeBattleBoard === 'ENEMY' ? `已击落 ${destroyedCount('AI')}/3` : `已损失 ${destroyedCount('HUMAN')}/3`}</span></div>${board}<div class="legend"><span class="miss-mark">○ 未命中</span><span class="hit-mark">× 命中</span><span class="destroyed-mark">✹ 击落</span></div></div><aside class="sidebar"><div class="card"><h3>${humanTurn ? '你的回合' : 'AI 回合'}</h3><div class="statline"><span>难度</span><b>${difficultyText[difficulty]}</b></div><div class="statline"><span>目标</span><b>${label}</b></div><div class="statline"><span>轮廓规则</span><b>${revealDestroyedPlane ? '显示' : '隐藏'}</b></div></div><div class="card status">${escapeHtml(humanTurn ? message : 'AI 仅根据公开攻击结果计算下一目标……')}</div><div class="controls">${button(selectedTarget ? `攻击 ${label}` : '请选择目标', 'fire', 'action primary', !humanTurn || activeBattleBoard !== 'ENEMY' || !selectedTarget || used)}</div></aside></section>`, `${difficultyText[difficulty]} AI`);
  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((tab) => tab.addEventListener('click', () => { activeBattleBoard = tab.dataset.board as BattleBoard; selectedTarget = null; render(); }));
  if (humanTurn && activeBattleBoard === 'ENEMY') document.querySelectorAll<HTMLButtonElement>('.board .cell').forEach((cell) => cell.addEventListener('click', () => { selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }; const already = session?.game.attacks.some((r) => r.attackerId === 'HUMAN' && posKey(r.position) === posKey(selectedTarget!)); message = already ? `${coord(selectedTarget)} 已攻击过。` : `已选择 ${coord(selectedTarget)}，点击攻击确认。`; render(); }));
  document.querySelector('#fire')?.addEventListener('click', () => { if (!session || !selectedTarget || session.game.currentPlayerId !== 'HUMAN') return; const target = { ...selectedTarget }; const outcome = humanAttack(session, target); session = outcome.session; selectedTarget = null; message = `${coord(target)}：${outcome.result.kind === 'MISS' ? '未命中 ○' : outcome.result.kind === 'HIT' ? '命中机身 ×' : '击中机头 ✹'}。`; if (session.game.status === 'FINISHED') stage = 'FINISHED'; render(); });
  scheduleAiTurn();
}

function renderFinished(): void {
  if (!session) return;
  const won = session.game.winnerId === 'HUMAN';
  const aiPlanes = session.game.players.find((p) => p.id === 'AI')?.planes ?? [];
  const humanPlanes = session.game.players.find((p) => p.id === 'HUMAN')?.planes ?? [];
  app.innerHTML = shell(`<section class="panel result"><h2>${won ? '你赢了' : 'AI 获胜'}</h2><p class="subtle">战斗结束，双方完整布局已公开。</p><div class="final-board-grid"><div><h3>AI 最终布局</h3>${boardHtml({ ownPlanes: aiPlanes, revealAllEnemy: true })}</div><div><h3>我的最终布局</h3>${boardHtml({ ownPlanes: humanPlanes })}</div></div><div class="controls room-controls">${button('再来一局', 'again', 'action primary')}${button('重新设置', 'settings')}<a class="action-link" href="/">返回模式首页</a></div></section>`, '练习结束');
  document.querySelector('#again')?.addEventListener('click', () => { humanFleet = createPlacementFleet('h'); selectedPlaneId = humanFleet[0].id; session = null; stage = 'PLACEMENT'; message = '拖动整架飞机调整位置；选中后可旋转。'; render(); });
  document.querySelector('#settings')?.addEventListener('click', () => { session = null; stage = 'SETTINGS'; render(); });
}

function render(): void { if (stage === 'SETTINGS') renderSettings(); else if (stage === 'PLACEMENT') renderPlacement(); else if (stage === 'PLAYING') renderBattle(); else renderFinished(); }

window.addEventListener('pointermove', (event) => {
  if (!drag || stage !== 'PLACEMENT') return;
  const board = document.querySelector<HTMLElement>('#ai-placement-board'); if (!board) return;
  const rect = board.getBoundingClientRect(); const x = Math.floor(((event.clientX - rect.left) / rect.width) * 10); const y = Math.floor(((event.clientY - rect.top) / rect.height) * 10);
  if (x < 0 || x > 9 || y < 0 || y > 9) return;
  const next = dragCandidate(humanFleet, drag.planeId, drag.grabbed, { x, y });
  const oldHead = drag.preview?.fleet.find((p) => p.id === drag!.planeId)?.head; const newHead = next.fleet.find((p) => p.id === drag!.planeId)?.head;
  if (oldHead?.x === newHead?.x && oldHead?.y === newHead?.y && drag.preview?.valid === next.valid) return;
  drag.preview = next; render();
});
window.addEventListener('pointerup', () => { if (!drag) return; if (drag.preview?.valid) { humanFleet = drag.preview.fleet; message = '飞机位置已更新。'; } else if (drag.preview) message = '该位置出界或重叠，已恢复原位置。'; drag = null; render(); });

render();
