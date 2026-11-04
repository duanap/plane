type IconName = 'plane' | 'play' | 'people' | 'bolt' | 'shield' | 'arrow' | 'rotate' | 'undo' | 'shuffle' | 'reset' | 'link' | 'exit' | 'target';
const paths: Record<IconName, string> = {
  plane: '<path d="M22 12.7v-1.4L13.6 8V3.1C13.6 1.9 12.9 1 12 1s-1.6.9-1.6 2.1V8L2 11.3v1.4l8.4-1.5v6L7 19.5V21l5-1 5 1v-1.5l-3.4-2.3v-6z" fill="currentColor" stroke="none"/>',
  play: '<path d="M7 4v16l14-8z" fill="currentColor" stroke="none"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v3"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z" fill="currentColor" stroke="none"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM12 3v18"/>',
  arrow: '<path d="M3 12h18m-7-7 7 7-7 7"/>',
  rotate: '<path d="M21 10a9 9 0 0 0-16-5L2 8m0-5v5h5M3 14a9 9 0 0 0 16 5l3-3m0 5v-5h-5"/>',
  undo: '<path d="m8 3-6 6 6 6M3 9h11a7 7 0 0 1 0 14"/>',
  shuffle: '<path d="M3 5h3c6 0 6 14 12 14h3m-4-4 4 4-4 4M3 19h3c2 0 3-2 4-4M14 9c1-2 2-4 4-4h3m-4-4 4 4-4 4"/>',
  reset: '<path d="M21 11a9 9 0 1 1-3-6l3 3m0-6v6h-6"/>',
  link: '<path d="m10 14 4-4m-5 8-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 6a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-2 2"/>',
  exit: '<path d="M10 3H3v18h7m5-15 6 6-6 6m-6-6h12"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
};

export function uiIcon(name: IconName): string {
  return `<svg class="ui-icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function actionLabel(labelHtml: string, id: string): string {
  const icons: Record<string, IconName> = { 'rotate-plane': 'rotate', 'undo-placement': 'undo', random: 'shuffle', reset: 'reset', ready: 'play', fire: 'target', 'copy-link': 'link', 'leave-room': 'exit', continue: 'play', 'join-room': 'arrow', 'open-join': 'arrow', 'create-room': 'play', restart: 'rotate', rematch: 'rotate' };
  return `${icons[id] ? uiIcon(icons[id]) : ''}<span>${labelHtml}</span>`;
}

export function lobbyArt(kind: 'plane' | 'radar'): string {
  return kind === 'plane'
    ? '<svg class="lobby-art" viewBox="0 0 260 140" aria-hidden="true"><defs><linearGradient id="lobby-plane-paint" x2="1" y2="1"><stop stop-color="#f0ffff"/><stop offset=".4" stop-color="#45d7ee"/><stop offset="1" stop-color="#08617b"/></linearGradient></defs><g stroke="#22d9f4" fill="none" stroke-width="1"><path d="m65 80 130 0 45 50H20zM50 96h160M35 113h190M95 80l-17 50m52-50v50m35-50 17 50"/><path d="M20 130h220" stroke-width="3"/></g><path d="M136 20c0-18-12-18-12 0v37L80 80v9l44-8v26l-14 9v6l20-5 20 5v-6l-14-9V81l44 8v-9l-44-23z" fill="url(#lobby-plane-paint)" stroke="#99faff"/><path d="M130 14v100" stroke="#ceffff" stroke-width="2"/></svg>'
    : '<svg class="lobby-art" viewBox="0 0 260 140" aria-hidden="true"><defs><linearGradient id="lobby-radar-paint" x1="1" x2="0" y2="1"><stop stop-color="#2cf4ff" stop-opacity=".9"/><stop offset="1" stop-color="#2cf4ff" stop-opacity="0"/></linearGradient></defs><g stroke="#24d4ed" fill="none"><ellipse cx="130" cy="117" rx="100" ry="17"/><ellipse cx="130" cy="117" rx="81" ry="10"/><circle cx="130" cy="62" r="50"/><circle cx="130" cy="62" r="36"/><circle cx="130" cy="62" r="22"/><path d="M130 12v100M80 62h100M95 27l70 70M95 97l70-70" opacity=".5"/></g><path d="m130 62-32-39a50 50 0 0 1 64 0z" fill="url(#lobby-radar-paint)"/><path d="m130 62 32-39" stroke="#c0ffff" stroke-width="3"/><circle cx="130" cy="62" r="4" fill="#32ecff"/><circle cx="151" cy="89" r="4" fill="#ffd24b"/></svg>';
}
