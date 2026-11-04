import { planeCells, validatePlacement } from '../game/geometry.ts';
import { directionLabel, draggedHead, gridPosition, movePlane, overlapPositions, rotatePlane, type FleetEdit } from '../game/fleet-placement.ts';
import type { Plane, Position } from '../game/types.ts';
import { boardFrame } from './board.ts';
import { actionLabel } from './neon-ui.ts';
const directionNames = { UP: '向上', RIGHT: '向右', DOWN: '向下', LEFT: '向左' };

type Occupant = { index: number; head: boolean };

function cellDetails(fleet: Plane[], occupants: Occupant[], selectedId: string, locked = false) {
  const cell = occupants.find((item) => fleet[item.index].id === selectedId) ?? occupants.find((item) => item.head) ?? occupants[0];
  const selected = occupants.some((item) => fleet[item.index].id === selectedId);
  return {
    index: cell.index,
    classes: `cell plane fleet-${cell.index}${cell.head ? ' head' : ''}${selected ? ' fleet-selected' : ''}${occupants.length > 1 ? ' fleet-overlap' : ''}`,
    label: `，${occupants.map((item) => `${item.index + 1} 号飞机${item.head ? '机头' : '机身'}`).join('、')}${occupants.length > 1 ? '，重叠' : ''}${locked ? '，已锁定' : '，点击旋转，可拖动'}`,
    content: cell.head ? `<span class="plane-mark">${cell.index + 1}<small>${directionLabel[fleet[cell.index].direction]}</small></span>` : '',
  };
}

export function fleetBoard(fleet: Plane[], selectedId: string, locked = false): string {
  const occupied = new Map<string, Occupant[]>();
  fleet.forEach((plane, index) => planeCells(plane).forEach((cell) => {
    const key = `${cell.position.x}:${cell.position.y}`;
    occupied.set(key, [...(occupied.get(key) ?? []), { index, head: cell.kind === 'HEAD' }]);
  }));
  let html = `<div class="board fleet-editor ${locked ? 'fleet-locked' : ''}" aria-label="飞机布阵棋盘">`;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
    const occupants = occupied.get(`${x}:${y}`) ?? [];
    const cell = occupants.length ? cellDetails(fleet, occupants, selectedId, locked) : null;
    const label = `${String.fromCharCode(65 + y)}${x + 1}`;
    html += `<button type="button" class="${cell?.classes ?? 'cell'}" data-x="${x}" data-y="${y}" ${cell ? `data-plane-index="${cell.index}" data-plane-indices="${occupants.map((item) => item.index).join(',')}"` : ''} aria-label="${label}${cell?.label ?? ''}" ${locked || !cell ? 'tabindex="-1"' : ''}>${cell?.content ?? ''}</button>`;
  }
  const overlaps = overlapPositions(fleet).length;
  return boardFrame(html + '</div>', `<div class="editor-feedback" aria-hidden="true">${overlaps ? `${overlaps} 格重叠，请调整后再确认布局。` : ''}</div>`);
}

export function fleetTools(fleet: Plane[], selectedId: string, undoAvailable: boolean, locked = false): string {
  return `<div class="fleet-tools"><div class="tool-heading"><span>你的编队</span><span>3 / 3 架</span></div><div class="fleet-list">${fleet.map((plane, index) => `<button class="fleet-choice fleet-${index}" data-select-plane="${index}" aria-pressed="${plane.id === selectedId}" ${locked ? 'disabled' : ''}><span class="fleet-swatch">${index + 1}</span><span>${index + 1} 号战机</span><strong>${String.fromCharCode(65 + plane.head.y)}${plane.head.x + 1} <small>${directionLabel[plane.direction]}<span class="fleet-direction-word">${directionNames[plane.direction]}</span></small></strong></button>`).join('')}</div>${locked ? '<p class="tool-hint">布局已锁定，等待对手准备。</p>' : `<div class="tool-buttons"><button class="action" id="rotate-plane">${actionLabel("旋转选中","rotate-plane")}</button><button class="action" id="undo-placement" ${undoAvailable ? '' : 'disabled'}>${actionLabel("撤销调整","undo-placement")}</button></div><div class="tool-buttons secondary-tools"><button class="action" id="random">${actionLabel("随机布局","random")}</button><button class="action" id="reset">${actionLabel("恢复初始","reset")}</button></div><p class="tool-hint">拖动飞机移动，点击飞机旋转。<br />也可选中飞机后用方向键移动，R 旋转。</p>`}</div>`;
}

type EditorOptions = {
  fleet: Plane[];
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (fleet: Plane[]) => void;
  onMessage: (message: string) => void;
  onGesture?: (active: boolean) => void;
};

export function bindFleetEditor(options: EditorOptions): void {
  const board = document.querySelector<HTMLElement>('.fleet-editor')!;
  let selectedId = options.selectedId;
  let gesture: { pointer: number; id: string; index: number; head: Position; start: Position; x: number; y: number; moved: boolean } | null = null;
  const announce = (message: string) => {
    options.onMessage(message);
    const feedback = document.querySelector('.editor-feedback');
    if (feedback) feedback.textContent = message;
  };
  const select = (index: number) => {
    selectedId = options.fleet[index].id;
    options.onSelect(selectedId);
    board.querySelectorAll<HTMLElement>('[data-plane-index]').forEach((cell) => {
      const occupants = cell.dataset.planeIndices!.split(',').map((value) => {
        const planeIndex = Number(value);
        const head = options.fleet[planeIndex].head;
        return { index: planeIndex, head: head.x === Number(cell.dataset.x) && head.y === Number(cell.dataset.y) };
      });
      const details = cellDetails(options.fleet, occupants, selectedId);
      cell.className = details.classes;
      cell.dataset.planeIndex = String(details.index);
      cell.innerHTML = details.content;
      cell.setAttribute('aria-label', `${String.fromCharCode(65 + Number(cell.dataset.y))}${Number(cell.dataset.x) + 1}${details.label}`);
    });
    document.querySelectorAll<HTMLElement>('[data-select-plane]').forEach((choice) => choice.setAttribute('aria-pressed', String(Number(choice.dataset.selectPlane) === index)));
  };
  const apply = (edit: FleetEdit, success: string) => {
    if (edit.valid) {
      if (edit.fleet.every((plane, index) => plane.head.x === options.fleet[index].head.x && plane.head.y === options.fleet[index].head.y && plane.direction === options.fleet[index].direction)) {
        announce('位置未变化。');
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const choiceIndex = active?.dataset.selectPlane;
      const focusedCell = active?.closest('.fleet-editor');
      const controlId = active?.id;
      const index = options.fleet.findIndex((plane) => plane.id === selectedId);
      announce(validatePlacement(edit.fleet).valid ? success : '已调整，有飞机重叠，请消除重叠后再确认布局。');
      options.onChange(edit.fleet);
      const focusTarget = choiceIndex !== undefined ? document.querySelector<HTMLElement>(`[data-select-plane="${choiceIndex}"]`)
        : focusedCell ? document.querySelector<HTMLElement>(`.fleet-editor .head[data-plane-index="${index}"]`)
          : controlId ? document.getElementById(controlId) : null;
      focusTarget?.focus({ preventScroll: true });
    }
    else announce('飞机不能超出棋盘，已保留原位置。');
  };
  const rotate = () => apply(rotatePlane(options.fleet, selectedId), '已顺时针旋转。贴近边缘时会自动向内调整。');
  const clearPreview = () => {
    board.classList.remove('is-dragging', 'invalid-drop');
    board.querySelectorAll('.drag-source, .drop-preview, .drop-invalid').forEach((cell) => cell.classList.remove('drag-source', 'drop-preview', 'drop-invalid'));
  };
  const preview = (head: Position) => {
    if (!gesture) return;
    clearPreview();
    board.classList.add('is-dragging');
    const edit = movePlane(options.fleet, gesture.id, head);
    const legal = edit.valid && validatePlacement(edit.fleet).valid;
    board.classList.toggle('invalid-drop', !legal);
    board.querySelectorAll<HTMLElement>(`[data-plane-index="${gesture.index}"]`).forEach((cell) => cell.classList.add('drag-source'));
    for (const cell of planeCells({ ...options.fleet[gesture.index], head })) {
      board.querySelector(`[data-x="${cell.position.x}"][data-y="${cell.position.y}"]`)?.classList.add(legal ? 'drop-preview' : 'drop-invalid');
    }
    announce(legal ? '松开即可放置。' : edit.valid ? '松开可放置，消除重叠后才能确认布局。' : '飞机超出棋盘，松开将回到原位。');
  };
  board.addEventListener('pointerdown', (event) => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    const cell = (event.target as Element).closest<HTMLElement>('[data-plane-index]');
    if (!cell) return;
    event.preventDefault();
    const index = Number(cell.dataset.planeIndex);
    select(index);
    const plane = options.fleet[index];
    gesture = { pointer: event.pointerId, id: plane.id, index, head: { ...plane.head }, start: gridPosition(event.clientX, event.clientY, board.getBoundingClientRect()), x: event.clientX, y: event.clientY, moved: false };
    board.setPointerCapture(event.pointerId);
    options.onGesture?.(true);
  });
  board.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 6) gesture.moved = true;
    if (gesture.moved) preview(draggedHead(gesture.head, gesture.start, gridPosition(event.clientX, event.clientY, board.getBoundingClientRect())));
  });
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const last = gesture;
    gesture = null;
    clearPreview();
    if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
    if (cancelled) announce('已取消拖动，保留原位置。');
    else if (last.moved) apply(movePlane(options.fleet, last.id, draggedHead(last.head, last.start, gridPosition(event.clientX, event.clientY, board.getBoundingClientRect()))), '位置已调整。');
    else rotate();
    options.onGesture?.(false);
  };
  board.addEventListener('pointerup', (event) => finish(event, false));
  board.addEventListener('pointercancel', (event) => finish(event, true));
  board.addEventListener('lostpointercapture', (event) => finish(event, true));
  board.addEventListener('click', (event) => {
    // Pointer gestures rotate on pointerup; detail=0 handles keyboard activation only.
    if (event.detail !== 0) return;
    const cell = (event.target as Element).closest<HTMLElement>('[data-plane-index]');
    if (cell) { select(Number(cell.dataset.planeIndex)); rotate(); }
  });
  const keyboard = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || gesture) return;
    const delta: Record<string, Position> = { ArrowUp: { x: 0, y: -1 }, ArrowRight: { x: 1, y: 0 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 } };
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); rotate(); }
    else if (delta[event.key]) {
      event.preventDefault();
      const plane = options.fleet.find((item) => item.id === selectedId)!;
      const offset = delta[event.key];
      apply(movePlane(options.fleet, selectedId, { x: plane.head.x + offset.x, y: plane.head.y + offset.y }), '位置已调整。');
    }
  };
  board.addEventListener('focusin', (event) => {
    const cell = (event.target as Element).closest<HTMLElement>('[data-plane-index]');
    if (cell) select(Number(cell.dataset.planeIndex));
  });
  board.addEventListener('keydown', keyboard);
  document.querySelectorAll<HTMLButtonElement>('[data-select-plane]').forEach((choice) => {
    choice.addEventListener('click', () => select(Number(choice.dataset.selectPlane)));
    choice.addEventListener('keydown', keyboard);
  });
  document.querySelector('#rotate-plane')?.addEventListener('click', rotate);
}
