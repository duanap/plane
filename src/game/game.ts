import { planeCells, validatePlacement } from './geometry.ts';
import type { Plane, PlaneCell, Position } from './types.ts';

export type AttackKind = 'MISS' | 'HIT' | 'DESTROYED';

export interface GameOptions {
  revealDestroyedPlane: boolean;
}

export interface PlayerState {
  id: string;
  planes: Plane[];
}

export interface AttackRecord {
  attackerId: string;
  targetId: string;
  position: Position;
  kind: AttackKind;
  planeId?: string;
}

export interface GameState {
  status: 'PLAYING' | 'FINISHED';
  players: [PlayerState, PlayerState];
  currentPlayerId: string;
  attacks: AttackRecord[];
  options: GameOptions;
  winnerId?: string;
}

export type AttackResult =
  | { kind: 'MISS' }
  | { kind: 'HIT'; planeId: string }
  | { kind: 'DESTROYED'; planeId: string; revealedCells: PlaneCell[] };

export interface AttackOutcome {
  game: GameState;
  result: AttackResult;
}

export type GameRuleErrorCode =
  | 'INVALID_PLAYERS'
  | 'INVALID_FLEET'
  | 'INVALID_FIRST_PLAYER'
  | 'ALREADY_ATTACKED'
  | 'GAME_FINISHED';

export class GameRuleError extends Error {
  readonly code: GameRuleErrorCode;

  constructor(code: GameRuleErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'GameRuleError';
  }
}

const DEFAULT_OPTIONS: GameOptions = { revealDestroyedPlane: true };

function clonePlane(plane: Plane): Plane {
  return {
    ...plane,
    head: { ...plane.head },
  };
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    id: player.id,
    planes: player.planes.map(clonePlane),
  };
}

export function createGame(
  players: PlayerState[],
  firstPlayerId?: string,
  options: Partial<GameOptions> = {},
): GameState {
  if (players.length !== 2 || players[0].id === players[1].id) {
    throw new GameRuleError('INVALID_PLAYERS', 'Game requires exactly two distinct players.');
  }

  for (const player of players) {
    if (player.planes.length !== 3 || !validatePlacement(player.planes).valid) {
      throw new GameRuleError('INVALID_FLEET', 'Each player must have exactly three legally placed planes.');
    }
  }

  const chosenFirst = firstPlayerId ?? players[Math.floor(Math.random() * players.length)].id;
  if (!players.some((player) => player.id === chosenFirst)) {
    throw new GameRuleError('INVALID_FIRST_PLAYER', 'First player must be one of the game players.');
  }

  return {
    status: 'PLAYING',
    players: [clonePlayer(players[0]), clonePlayer(players[1])],
    currentPlayerId: chosenFirst,
    attacks: [],
    options: { ...DEFAULT_OPTIONS, ...options },
  };
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

export function attack(game: GameState, position: Position): AttackOutcome {
  if (game.status === 'FINISHED') {
    throw new GameRuleError('GAME_FINISHED', 'The game is already finished.');
  }

  const attackerIndex = game.players.findIndex((player) => player.id === game.currentPlayerId);
  const targetIndex = attackerIndex === 0 ? 1 : 0;
  const attacker = game.players[attackerIndex];
  const target = game.players[targetIndex];

  const wasAlreadyAttacked = game.attacks.some(
    (record) => record.attackerId === attacker.id && samePosition(record.position, position),
  );
  if (wasAlreadyAttacked) {
    throw new GameRuleError('ALREADY_ATTACKED', 'This coordinate has already been attacked.');
  }

  const nextPlayers: [PlayerState, PlayerState] = [clonePlayer(game.players[0]), clonePlayer(game.players[1])];
  const nextTarget = nextPlayers[targetIndex];

  let result: AttackResult = { kind: 'MISS' };
  for (const plane of nextTarget.planes) {
    const hitCell = planeCells(plane).find((cell) => samePosition(cell.position, position));
    if (!hitCell) continue;

    if (hitCell.kind === 'HEAD') {
      plane.destroyed = true;
      result = {
        kind: 'DESTROYED',
        planeId: plane.id,
        revealedCells: planeCells(plane),
      };
    } else {
      result = { kind: 'HIT', planeId: plane.id };
    }
    break;
  }

  const record: AttackRecord = {
    attackerId: attacker.id,
    targetId: target.id,
    position: { ...position },
    kind: result.kind,
    ...('planeId' in result ? { planeId: result.planeId } : {}),
  };

  const targetDefeated = nextTarget.planes.every((plane) => plane.destroyed);
  const nextGame: GameState = {
    status: targetDefeated ? 'FINISHED' : 'PLAYING',
    players: nextPlayers,
    currentPlayerId: targetDefeated ? attacker.id : target.id,
    attacks: [...game.attacks, record],
    options: { ...game.options },
    ...(targetDefeated ? { winnerId: attacker.id } : {}),
  };

  return { game: nextGame, result };
}
