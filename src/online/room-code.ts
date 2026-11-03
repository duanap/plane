export function normalizeRoomCode(value: string): string {
  return value.trim();
}

export function isRoomCode(value: string): boolean {
  return /^[0-9]{6}$/.test(normalizeRoomCode(value));
}
