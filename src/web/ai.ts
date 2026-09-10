import { planeCells, randomFleet, validatePlacement } from '../game/geometry.ts';
import type { AttackKind, GameState } from '../game/game.ts';
import type { Direction, Plane, PlaneCell, Position } from '../game/types.ts';
import { createAiSession, humanAttack, runAiTurn, type AiSessionState } from '../ai/session.ts';
import type { AiDifficulty } from '../ai/ai.ts';

type Stage = 'DIFFICULTY' | 'PLACEMENT' | 'PLAYING' | 'FINISHED';
type BattleBoard = 'ENEMY' | 'OWN';

const appElement = document.querySelector<HTMLDivElement>('#app');
if (!appElement) throw new Error('Missing #app');
const app: HTMLDivElement = appElement;

let stage: Stage = 'DIFFICULTY';
let difficulty: AiDifficulty = 'NORMAL';
let humanFleet: Plane[] = [];
let placementDirection: Direction = 'UP';
let selectedTarget: Position | null = null;
let session: AiSessionState | null = null;
let lastMessage = '选择一个难度开始练习。';
let activeBattleBoard: BattleBoard = 'ENEMY';
let aiTurnScheduled = false;

const directions: Direction[] = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const directionText: Record<Direction, string> = {
  UP: '↑ 向上', RIGHT: '→ 向右', DOWN: '↓ 向下', LEFT: '← 向左',
};
const difficultyText: Record<AiDifficulty, string> = {
  EASY: '简单', NORMAL: '普通', HARD: '困难',
};

function posKey(position: Position): string { return `${position.x}:${position.y}`; }
function coord(position: Position): string { return `${String.fromCharCode(65 + position.y)}${position.x + 1}`; }
function button(label: string, id: string, className = 'action', disabled = false): string {
  return `<button class="${className}" id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function shell(content: string, badge: string): string {
  return `<div class="shell"><header class="topbar"><div class="brand"><h1>炸飞机</h1><p>人机练习 · AI 不读取你的隐藏布局</p></div><div class="top-actions"><a class="text-link" href="/">本地双人</a><a class="text-link" href="/online.html">在线对战</a><div class="badge">${badge}</div></div></header>${content}</div>`;
}

function attackMap(game: GameState, attackerId: 'HUMAN' | 'AI'): Map<string, AttackKind> {
  return new Map(game.attacks.filter((record) => record.attackerId === attackerId).map((record) => [posKey(record.position), record.kind]));
}

function planeCellMap(planes: Plane[]): Map<string, PlaneCell> {
  const result = new Map<string, PlaneCell>();
  for (const plane of planes) for (const cell of planeCells(plane)) result.set(posKey(cell.position), cell);
  return result;
}

function boardHtml(options: {
  ownPlanes?: Plane[];
  attackViewFor?: 'HUMAN' | 'AI';
  interactive?: boolean;
  revealAllEnemy?: boolean;
}): string {
  const game = session?.game;
  const ownCells = planeCellMap(options.ownPlanes ?? []);
  const attacks = game && options.attackViewFor ? attackMap(game, options.attackViewFor) : new Map<string, AttackKind>();
  const opponent = game && options.attackViewFor ? game.players.find((player) => player.id !== options.attackViewFor) : undefined;
  const revealedCells = new Map<string, PlaneCell>();
  for (const plane of opponent?.planes ?? []) {
    if (plane.destroyed || options.revealAllEnemy) {
      for (const cell of planeCells(plane)) revealedCells.set(posKey(cell.position), cell);
    }
  }

  let html = '<div class="board">';
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      const position = { x, y };
      const key = posKey(position);
      const classes = ['cell'];
      const own = ownCells.get(key);
      const attackKind = attacks.get(key);
      const revealed = revealedCells.get(key);
      if (own) classes.push('plane', own.kind === 'HEAD' ? 'head' : 'body');
      if (attackKind === 'MISS') classes.push('miss');
      if (attackKind === 'HIT') classes.push('hit');
      if (attackKind === 'DESTROYED') classes.push('destroyed');
      if (revealed) classes.push('revealed', revealed.kind === 'HEAD' ? 'revealed-head' : 'revealed-body');
      if (selectedTarget && options.attackViewFor === 'HUMAN' && selectedTarget.x === x && selectedTarget.y === y) classes.push('selected');
      const tabindex = options.interactive ? '' : 'tabindex="-1"';
      html += `<button class="${classes.join(' ')}" data-x="${x}" data-y="${y}" title="${coord(position)}" aria-label="${coord(position)}" ${tabindex}></button>`;
    }
  }
  return `${html}</div>`;
}

function renderDifficulty(): void {
  app.innerHTML = shell(`<section class="panel online-home"><div class="online-hero"><h2>选择 AI 难度</h2><p class="subtle">三档 AI 都只读取自己的公开攻击结果，不会查看你的真实飞机坐标。</p></div><div class="difficulty-grid">
    <button class="difficulty-card" data-difficulty="EASY"><strong>简单</strong><span>随机攻击未尝试坐标，适合熟悉规则。</span></button>
    <button class="difficulty-card featured" data-difficulty="NORMAL"><strong>普通</strong><span>命中后会追踪附近格子，推荐首次挑战。</span></button>
    <button class="difficulty-card" data-difficulty="HARD"><strong>困难</strong><span>根据合法飞机形状和 MISS/HIT 信息进行概率推理。</span></button>
  </div><div class="notice">先选难度，然后部署你的 3 架战机。</div></section>`, '人机练习');
  document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((item) => item.addEventListener('click', () => {
    difficulty = item.dataset.difficulty as AiDifficulty;
    stage = 'PLACEMENT';
    humanFleet = [];
    lastMessage = '点击棋盘选择机头位置。';
    render();
  }));
}

function renderPlacement(): void {
  const ready = humanFleet.length === 3 && validatePlacement(humanFleet).valid;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-title"><strong>部署你的战机</strong><span>${humanFleet.length}/3 架</span></div>${boardHtml({ ownPlanes: humanFleet, interactive: true })}<div class="legend" style="margin-top:12px"><span><i class="dot"></i> 已部署战机</span><span>机头坐标 + 方向决定整架飞机</span></div></div><aside class="sidebar"><div class="card"><h3>难度</h3><div class="statline"><span>当前 AI</span><b>${difficultyText[difficulty]}</b></div><button class="action" id="change-difficulty">重新选择难度</button></div><div class="card"><h3>当前方向</h3><div style="font-size:26px">${directionText[placementDirection]}</div></div><div class="card status">${lastMessage}</div><div class="controls">${button('旋转战机 ↻','rotate')}${button('随机摆放 3 架','random')}${button('撤销最后一架','undo','action',humanFleet.length===0)}${button('重新摆放','reset','action danger',humanFleet.length===0)}${button('开始练习','start','action primary',!ready)}</div></aside></section>`, `${difficultyText[difficulty]} AI`);

  document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
    if (humanFleet.length >= 3) { lastMessage = '已经摆满 3 架飞机，可撤销或开始练习。'; render(); return; }
    const candidate: Plane = { id: `h${humanFleet.length + 1}`, head: { x: Number(cell.dataset.x), y: Number(cell.dataset.y) }, direction: placementDirection, destroyed: false };
    const validation = validatePlacement([...humanFleet, candidate]);
    if (!validation.valid) lastMessage = validation.reason === 'OUT_OF_BOUNDS' ? '该位置会让飞机超出战场。' : '该位置与已有飞机重叠。';
    else { humanFleet = [...humanFleet, candidate]; lastMessage = `已部署第 ${humanFleet.length} 架，机头 ${coord(candidate.head)}。`; }
    render();
  }));
  document.querySelector('#rotate')?.addEventListener('click', () => { placementDirection = directions[(directions.indexOf(placementDirection)+1)%directions.length]; render(); });
  document.querySelector('#random')?.addEventListener('click', () => { humanFleet = randomFleet('h'); lastMessage = '已生成合法随机布局。'; render(); });
  document.querySelector('#undo')?.addEventListener('click', () => { humanFleet = humanFleet.slice(0,-1); lastMessage = '已撤销最后一架飞机。'; render(); });
  document.querySelector('#reset')?.addEventListener('click', () => { humanFleet = []; lastMessage = '布局已清空。'; render(); });
  document.querySelector('#change-difficulty')?.addEventListener('click', () => { stage = 'DIFFICULTY'; render(); });
  document.querySelector('#start')?.addEventListener('click', () => {
    session = createAiSession(humanFleet, difficulty);
    stage = 'PLAYING';
    selectedTarget = null;
    activeBattleBoard = 'ENEMY';
    lastMessage = session.game.currentPlayerId === 'HUMAN' ? '你获得先手，请选择攻击坐标。' : 'AI 获得先手，正在推理……';
    render();
  });
}

function destroyedCount(playerId: 'HUMAN' | 'AI'): number {
  return session?.game.players.find((player) => player.id === playerId)?.planes.filter((plane) => plane.destroyed).length ?? 0;
}

function scheduleAiTurn(): void {
  if (!session || session.game.status !== 'PLAYING' || session.game.currentPlayerId !== 'AI' || aiTurnScheduled) return;
  aiTurnScheduled = true;
  window.setTimeout(() => {
    if (!session || session.game.status !== 'PLAYING' || session.game.currentPlayerId !== 'AI') { aiTurnScheduled = false; return; }
    const outcome = runAiTurn(session);
    session = outcome.session;
    const resultText = outcome.result.kind === 'MISS' ? '未命中' : outcome.result.kind === 'HIT' ? '命中机身' : '击中机头，击落一架';
    lastMessage = `AI 攻击 ${coord(outcome.position)}：${resultText}。`;
    aiTurnScheduled = false;
    if (session.game.status === 'FINISHED') stage = 'FINISHED';
    render();
  }, 420);
}

function renderBattleBoard(): string {
  if (!session) return '';
  if (activeBattleBoard === 'OWN') {
    return `<div class="board-title"><strong>我的战场</strong><span>已损失 ${destroyedCount('HUMAN')}/3</span></div>${boardHtml({ ownPlanes: session.game.players.find((p)=>p.id==='HUMAN')?.planes ?? [], attackViewFor: 'AI' })}<div class="legend" style="margin-top:12px"><span><i class="dot"></i> 我的飞机</span><span>○ AI 未命中</span><span>× AI 命中</span><span>✹ 机头被击落</span></div>`;
  }
  return `<div class="board-title"><strong>AI 战场</strong><span>已击落 ${destroyedCount('AI')}/3</span></div>${boardHtml({ attackViewFor: 'HUMAN', interactive: session.game.currentPlayerId === 'HUMAN' })}<div class="legend" style="margin-top:12px"><span>○ 未命中</span><span>× 命中机身</span><span>✹ 击落机头</span></div>`;
}

function renderBattle(): void {
  if (!session) return;
  if (session.game.status === 'FINISHED') { stage = 'FINISHED'; renderFinished(); return; }
  const humanTurn = session.game.currentPlayerId === 'HUMAN';
  const targetLabel = selectedTarget ? coord(selectedTarget) : '未选择';
  const alreadyAttacked = selectedTarget ? session.game.attacks.some((record) => record.attackerId === 'HUMAN' && posKey(record.position) === posKey(selectedTarget!)) : false;
  app.innerHTML = shell(`<section class="panel game-layout"><div class="board-wrap"><div class="board-tabs"><button class="tab ${activeBattleBoard==='ENEMY'?'active':''}" data-board="ENEMY">AI 战场</button><button class="tab ${activeBattleBoard==='OWN'?'active':''}" data-board="OWN">我的战场</button></div>${renderBattleBoard()}</div><aside class="sidebar"><div class="card"><h3>${humanTurn ? '你的回合' : 'AI 回合'}</h3><div class="statline"><span>难度</span><b>${difficultyText[difficulty]}</b></div><div class="statline"><span>目标坐标</span><b>${targetLabel}</b></div><div class="statline"><span>我方损失</span><b>${destroyedCount('HUMAN')}/3</b></div><div class="statline"><span>敌机击落</span><b>${destroyedCount('AI')}/3</b></div></div><div class="card status">${humanTurn ? lastMessage : 'AI 仅根据公开攻击结果计算下一目标……'}</div><div class="controls">${button(selectedTarget ? `攻击 ${targetLabel}` : '请选择目标','fire','action primary',!humanTurn || activeBattleBoard!=='ENEMY' || !selectedTarget || alreadyAttacked)}</div></aside></section>`, `${difficultyText[difficulty]} AI · ${humanTurn ? '你的回合' : 'AI 推理中'}`);

  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach((tab) => tab.addEventListener('click', () => { activeBattleBoard = tab.dataset.board as BattleBoard; selectedTarget = null; render(); }));
  if (humanTurn && activeBattleBoard === 'ENEMY') {
    document.querySelectorAll<HTMLButtonElement>('.cell').forEach((cell) => cell.addEventListener('click', () => {
      selectedTarget = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
      const used = session?.game.attacks.some((record) => record.attackerId === 'HUMAN' && posKey(record.position) === posKey(selectedTarget!));
      lastMessage = used ? `${coord(selectedTarget)} 已经攻击过，请选择其他坐标。` : `已锁定 ${coord(selectedTarget)}，点击攻击按钮确认。`;
      render();
    }));
  }
  document.querySelector('#fire')?.addEventListener('click', () => {
    if (!session || !selectedTarget || session.game.currentPlayerId !== 'HUMAN') return;
    const target = selectedTarget;
    const outcome = humanAttack(session, target);
    session = outcome.session;
    selectedTarget = null;
    lastMessage = outcome.result.kind === 'MISS' ? `${coord(target)}：未命中。` : outcome.result.kind === 'HIT' ? `${coord(target)}：命中机身！` : `${coord(target)}：击中机头，击落敌机！`;
    if (session.game.status === 'FINISHED') stage = 'FINISHED';
    render();
  });
  scheduleAiTurn();
}

function finalBoard(playerId: 'HUMAN' | 'AI', attackViewFor: 'HUMAN' | 'AI'): string {
  if (!session) return '';
  const planes = session.game.players.find((player) => player.id === playerId)?.planes ?? [];
  return boardHtml({ ownPlanes: playerId === 'HUMAN' ? planes : undefined, attackViewFor, revealAllEnemy: playerId === 'AI' });
}

function renderFinished(): void {
  if (!session) return;
  const humanWon = session.game.winnerId === 'HUMAN';
  const humanAttacks = session.game.attacks.filter((record) => record.attackerId === 'HUMAN');
  const aiAttacks = session.game.attacks.filter((record) => record.attackerId === 'AI');
  const humanHits = humanAttacks.filter((record) => record.kind !== 'MISS').length;
  app.innerHTML = shell(`<section class="panel result"><h2>${humanWon ? '🎉 你赢了' : 'AI 获胜'}</h2><p class="subtle">${humanWon ? '你率先找到了全部 3 个敌机机头。' : `${difficultyText[difficulty]} AI 率先击落了你的全部战机。`}</p><div class="result-grid"><div class="card">你的攻击<strong>${humanAttacks.length}</strong></div><div class="card">你的命中<strong>${humanHits}</strong></div><div class="card">AI 攻击<strong>${aiAttacks.length}</strong></div></div><div class="final-board-section"><div class="board-tabs"><button class="tab ${activeBattleBoard==='ENEMY'?'active':''}" data-final-board="ENEMY">AI 最终战场</button><button class="tab ${activeBattleBoard==='OWN'?'active':''}" data-final-board="OWN">我的最终战场</button></div><div class="board-wrap">${activeBattleBoard === 'ENEMY' ? `<div class="board-title"><strong>AI 完整布局</strong><span>机头已标记</span></div>${finalBoard('AI','HUMAN')}` : `<div class="board-title"><strong>我的完整布局</strong><span>AI 攻击记录</span></div>${finalBoard('HUMAN','AI')}`}</div></div><div class="controls result-controls">${button(`再来一局 · ${difficultyText[difficulty]}`,'restart','action primary')}${button('重新选择难度','difficulty','action')}<a class="action action-link" href="/">返回首页</a></div></section>`, '练习结束');
  document.querySelectorAll<HTMLButtonElement>('[data-final-board]').forEach((tab) => tab.addEventListener('click', () => { activeBattleBoard = tab.dataset.finalBoard as BattleBoard; render(); }));
  document.querySelector('#restart')?.addEventListener('click', () => { stage='PLACEMENT'; humanFleet=[]; session=null; selectedTarget=null; placementDirection='UP'; activeBattleBoard='ENEMY'; lastMessage='点击棋盘选择机头位置。'; render(); });
  document.querySelector('#difficulty')?.addEventListener('click', () => { stage='DIFFICULTY'; session=null; humanFleet=[]; selectedTarget=null; activeBattleBoard='ENEMY'; lastMessage='选择一个难度开始练习。'; render(); });
}

function render(): void {
  if (stage === 'DIFFICULTY') return renderDifficulty();
  if (stage === 'PLACEMENT') return renderPlacement();
  if (stage === 'PLAYING') return renderBattle();
  renderFinished();
}

render();
