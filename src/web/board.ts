export function boardFrame(board: string, overlay = ''): string {
  return `<div class="coordinate-board"><div class="column-labels" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('')}</div><div class="row-labels" aria-hidden="true">${'ABCDEFGHIJ'.split('').map((letter) => `<span>${letter}</span>`).join('')}</div>${board}${overlay}</div>`;
}
