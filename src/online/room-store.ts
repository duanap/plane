import { attack as resolveAttack, createGame, GameRuleError, type GameState } from '../game/game.ts';
import { isInsideBoard, planeCells, validatePlacement } from '../game/geometry.ts';
import type { Plane, Position } from '../game/types.ts';
import { isRoomCode, normalizeRoomCode } from './room-code.ts';

export type PlayerId = 'A' | 'B';
export type RoomStatus = 'WAITING' | 'PLACEMENT' | 'PLAYING' | 'FINISHED';
export interface RoomSettings {
  revealDestroyedPlanes: boolean;
}

export type RoomErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_TOKEN'
  | 'INVALID_PHASE'
  | 'INVALID_FLEET'
  | 'INVALID_SETTINGS'
  | 'FLEET_REQUIRED'
  | 'NOT_YOUR_TURN'
  | 'INVALID_COORDINATE'
  | 'ALREADY_ATTACKED'
  | 'REMATCH_UNAVAILABLE';

export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'RoomError';
  }
}

interface Seat {
  id: PlayerId;
  token: string;
  fleet?: Plane[];
  ready: boolean;
  rematch: boolean;
  connections: number;
}

interface Room {
  id: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: { A: Seat; B?: Seat };
  game?: GameState;
  lastActivityAt: number;
}

export interface PublicPlaneCell {
  kind: 'HEAD' | 'BODY';
  position: Position;
}

export interface PublicDestroyedPlane {
  cells: PublicPlaneCell[];
}

export type PublicAttackResult =
  | { kind: 'MISS' }
  | { kind: 'HIT' }
  | { kind: 'DESTROYED'; revealedCells: PublicPlaneCell[] };

export interface PublicAttackRecord {
  attackerId: string;
  targetId: string;
  position: Position;
  kind: 'MISS' | 'HIT' | 'DESTROYED';
}

export interface PublicRoomView {
  roomId: string;
  settings: RoomSettings;
  status: RoomStatus;
  playerId: PlayerId;
  players: {
    A: { joined: true; ready: boolean; connected: boolean };
    B: { joined: boolean; ready: boolean; connected: boolean };
  };
  ownFleet?: Plane[];
  currentPlayerId?: string;
  winnerId?: string;
  attacks: PublicAttackRecord[];
  opponentRevealedPlanes: PublicDestroyedPlane[];
  destroyedCounts: Record<PlayerId, number>;
  rematchVotes: Record<PlayerId, boolean>;
}

export interface RoomIdentity {
  roomId: string;
  playerId: PlayerId;
  token: string;
}

interface RoomStoreOptions {
  code?: () => string;
  token?: () => string;
  random?: () => number;
  now?: () => number;
  ttlMs?: number;
}

const CODE_ALPHABET = '0123456789';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function secureIndex(max: number): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] % max;
}

function defaultCode(): string {
  let value = '';
  for (let i = 0; i < 6; i += 1) value += CODE_ALPHABET[secureIndex(CODE_ALPHABET.length)];
  return value;
}

function defaultToken(): string {
  const values = new Uint8Array(24);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function clonePlane(plane: Plane): Plane {
  return { ...plane, head: { ...plane.head } };
}

function cloneFleet(fleet: Plane[] | undefined): Plane[] | undefined {
  return fleet?.map(clonePlane);
}

function normalizeRoomId(roomId: string): string {
  return normalizeRoomCode(roomId);
}

function isPlaneInput(value: unknown): value is Plane {
  if (!value || typeof value !== 'object') return false;
  const plane = value as Partial<Plane> & { head?: Partial<Position> };
  return typeof plane.id === 'string'
    && plane.id.length > 0
    && Boolean(plane.head)
    && Number.isInteger(plane.head?.x)
    && Number.isInteger(plane.head?.y)
    && (plane.direction === 'UP' || plane.direction === 'RIGHT' || plane.direction === 'DOWN' || plane.direction === 'LEFT')
    && plane.destroyed === false;
}

export class RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly makeCode: () => string;
  private readonly makeToken: () => string;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: RoomStoreOptions = {}) {
    this.makeCode = options.code ?? defaultCode;
    this.makeToken = options.token ?? defaultToken;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  createRoom(settings: Partial<RoomSettings> = {}): RoomIdentity {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || (settings.revealDestroyedPlanes !== undefined && typeof settings.revealDestroyedPlanes !== 'boolean')) {
      throw new RoomError('INVALID_SETTINGS', 'revealDestroyedPlanes must be a boolean.');
    }
    let roomId = '';
    for (let attempts = 0; attempts < 100; attempts += 1) {
      roomId = normalizeRoomId(this.makeCode());
      if (isRoomCode(roomId) && !this.rooms.has(roomId)) break;
      roomId = '';
    }
    if (!roomId) throw new Error('Unable to allocate a unique room code.');

    const token = this.makeToken();
    const room: Room = {
      id: roomId,
      status: 'WAITING',
      settings: { revealDestroyedPlanes: settings.revealDestroyedPlanes ?? false },
      players: { A: { id: 'A', token, ready: false, rematch: false, connections: 0 } },
      lastActivityAt: this.now(),
    };
    this.rooms.set(roomId, room);
    return { roomId, playerId: 'A', token };
  }

  joinRoom(roomIdInput: string): RoomIdentity {
    const room = this.requireRoom(roomIdInput);
    if (room.players.B) throw new RoomError('ROOM_FULL', 'The room already has two players.');
    if (room.status !== 'WAITING') throw new RoomError('INVALID_PHASE', 'The room can no longer be joined.');

    const token = this.makeToken();
    room.players.B = { id: 'B', token, ready: false, rematch: false, connections: 0 };
    room.status = 'PLACEMENT';
    this.markActivity(room);
    return { roomId: room.id, playerId: 'B', token };
  }

  getView(roomIdInput: string, token: string): PublicRoomView {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    this.markActivity(room);

    const opponentId: PlayerId = seat.id === 'A' ? 'B' : 'A';
    const ownGamePlayer = room.game?.players.find((player) => player.id === seat.id);
    const opponentGamePlayer = room.game?.players.find((player) => player.id === opponentId);
    const ownFleet = ownGamePlayer?.planes ?? seat.fleet;

    const opponentRevealedPlanes = (opponentGamePlayer?.planes ?? [])
      .filter((plane) => room.status === 'FINISHED' || plane.destroyed)
      .map((plane) => ({
        cells: (room.status === 'FINISHED' || room.settings.revealDestroyedPlanes
          ? planeCells(plane)
          : planeCells(plane).filter((cell) => cell.kind === 'HEAD'))
          .map((cell) => ({ kind: cell.kind, position: { ...cell.position } })),
      }));

    const attacks: PublicAttackRecord[] = (room.game?.attacks ?? []).map((record) => ({
      attackerId: record.attackerId,
      targetId: record.targetId,
      position: { ...record.position },
      kind: record.kind,
    }));

    const destroyedCounts: Record<PlayerId, number> = {
      A: room.game?.players.find((player) => player.id === 'A')?.planes.filter((plane) => plane.destroyed).length ?? 0,
      B: room.game?.players.find((player) => player.id === 'B')?.planes.filter((plane) => plane.destroyed).length ?? 0,
    };

    return {
      roomId: room.id,
      settings: { ...room.settings },
      status: room.status,
      playerId: seat.id,
      players: {
        A: { joined: true, ready: room.players.A.ready, connected: room.players.A.connections > 0 },
        B: {
          joined: Boolean(room.players.B),
          ready: room.players.B?.ready ?? false,
          connected: (room.players.B?.connections ?? 0) > 0,
        },
      },
      ...(ownFleet ? { ownFleet: cloneFleet(ownFleet) } : {}),
      ...(room.game ? { currentPlayerId: room.game.currentPlayerId } : {}),
      ...(room.game?.winnerId ? { winnerId: room.game.winnerId } : {}),
      attacks,
      opponentRevealedPlanes,
      destroyedCounts,
      rematchVotes: { A: room.players.A.rematch, B: room.players.B?.rematch ?? false },
    };
  }

  submitFleet(roomIdInput: string, token: string, fleet: Plane[]): void {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    if (room.status !== 'PLACEMENT') throw new RoomError('INVALID_PHASE', 'Fleets can only be submitted during placement.');
    if (seat.ready) throw new RoomError('INVALID_PHASE', 'A ready player cannot change their fleet.');
    if (!Array.isArray(fleet) || fleet.length !== 3 || !fleet.every(isPlaneInput)) {
      throw new RoomError('INVALID_FLEET', 'Submit exactly three legal, non-overlapping planes.');
    }
    const ids = new Set(fleet.map((plane) => plane.id));
    if (
      ids.size !== 3
      || !validatePlacement(fleet).valid
    ) {
      throw new RoomError('INVALID_FLEET', 'Submit exactly three legal, non-overlapping planes.');
    }
    seat.fleet = cloneFleet(fleet);
    this.markActivity(room);
  }

  ready(roomIdInput: string, token: string): void {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    if (room.status !== 'PLACEMENT') throw new RoomError('INVALID_PHASE', 'Ready is only available during placement.');
    if (!seat.fleet) throw new RoomError('FLEET_REQUIRED', 'Submit a legal fleet before becoming ready.');

    seat.ready = true;
    const other = seat.id === 'A' ? room.players.B : room.players.A;
    if (other?.ready && other.fleet && room.players.B) {
      const first: PlayerId = this.random() < 0.5 ? 'A' : 'B';
      room.game = createGame(
        [
          { id: 'A', planes: room.players.A.fleet! },
          { id: 'B', planes: room.players.B.fleet! },
        ],
        first,
      );
      room.status = 'PLAYING';
    }
    this.markActivity(room);
  }

  attack(roomIdInput: string, token: string, position: Position): { result: PublicAttackResult } {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    if (room.status !== 'PLAYING' || !room.game) throw new RoomError('INVALID_PHASE', 'Attacks are only available during battle.');
    if (!Number.isInteger(position.x) || !Number.isInteger(position.y) || !isInsideBoard(position)) {
      throw new RoomError('INVALID_COORDINATE', 'Attack coordinate must be an integer cell inside the 10x10 board.');
    }
    if (room.game.currentPlayerId !== seat.id) throw new RoomError('NOT_YOUR_TURN', 'It is not your turn.');

    try {
      const outcome = resolveAttack(room.game, position);
      room.game = outcome.game;
      if (room.game.status === 'FINISHED') room.status = 'FINISHED';
      this.markActivity(room);
      const result: PublicAttackResult = outcome.result.kind === 'MISS'
        ? { kind: 'MISS' }
        : outcome.result.kind === 'HIT'
          ? { kind: 'HIT' }
          : {
              kind: 'DESTROYED',
              revealedCells: outcome.result.revealedCells.filter((cell) => room.settings.revealDestroyedPlanes || cell.kind === 'HEAD').map((cell) => ({
                kind: cell.kind,
                position: { ...cell.position },
              })),
            };
      return { result };
    } catch (error) {
      if (error instanceof GameRuleError && error.code === 'ALREADY_ATTACKED') {
        throw new RoomError('ALREADY_ATTACKED', 'This coordinate has already been attacked.');
      }
      throw error;
    }
  }

  voteRematch(roomIdInput: string, token: string): void {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    if (room.status !== 'FINISHED') throw new RoomError('REMATCH_UNAVAILABLE', 'Rematch is only available after the game finishes.');
    seat.rematch = true;

    if (room.players.A.rematch && room.players.B?.rematch) {
      room.players.A.fleet = undefined;
      room.players.A.ready = false;
      room.players.A.rematch = false;
      room.players.B.fleet = undefined;
      room.players.B.ready = false;
      room.players.B.rematch = false;
      room.game = undefined;
      room.status = 'PLACEMENT';
    }
    this.markActivity(room);
  }

  connectionOpened(roomIdInput: string, token: string): void {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    seat.connections += 1;
    this.markActivity(room);
  }

  connectionClosed(roomIdInput: string, token: string): void {
    const room = this.requireRoom(roomIdInput);
    const seat = this.requireSeat(room, token);
    seat.connections = Math.max(0, seat.connections - 1);
    this.markActivity(room);
  }

  touch(roomIdInput: string): void {
    this.markActivity(this.requireRoom(roomIdInput));
  }

  cleanup(now = this.now()): number {
    let removed = 0;
    for (const [roomId, room] of this.rooms) {
      if (now - room.lastActivityAt > this.ttlMs) {
        this.rooms.delete(roomId);
        removed += 1;
      }
    }
    return removed;
  }

  private requireRoom(roomIdInput: string): Room {
    const room = this.rooms.get(normalizeRoomId(roomIdInput));
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Room not found.');
    return room;
  }

  private requireSeat(room: Room, token: string): Seat {
    if (room.players.A.token === token) return room.players.A;
    if (room.players.B?.token === token) return room.players.B;
    throw new RoomError('INVALID_TOKEN', 'Player token is invalid for this room.');
  }

  private markActivity(room: Room): void {
    room.lastActivityAt = this.now();
  }
}
