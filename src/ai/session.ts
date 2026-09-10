import { attack, createGame, type AttackResult, type GameState } from '../game/game.ts';
import { randomFleet, validatePlacement } from '../game/geometry.ts';
import type { Plane, Position } from '../game/types.ts';
import { chooseAiAttack, type AiDifficulty, type AiObservation } from './ai.ts';

export type AiSessionErrorCode = 'NOT_HUMAN_TURN' | 'NOT_AI_TURN' | 'INVALID_HUMAN_FLEET' | 'INVALID_AI_FLEET';

export class AiSessionError extends Error {
  readonly code: AiSessionErrorCode;
  constructor(code: AiSessionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiSessionError';
  }
}

export interface AiSessionState {
  difficulty: AiDifficulty;
  game: GameState;
  aiObservations: AiObservation[];
  random: () => number;
}

export interface CreateAiSessionOptions {
  random?: () => number;
  firstPlayerId?: 'HUMAN' | 'AI';
  aiFleet?: Plane[];
}

export interface HumanAttackOutcome {
  session: AiSessionState;
  result: AttackResult;
}

export interface AiTurnOutcome extends HumanAttackOutcome {
  position: Position;
}

function cloneObservation(observation: AiObservation): AiObservation {
  return {
    position: { ...observation.position },
    kind: observation.kind,
    ...(observation.revealedCells ? {
      revealedCells: observation.revealedCells.map((cell) => ({
        ...cell,
        position: { ...cell.position },
      })),
    } : {}),
  };
}

function toObservation(position: Position, result: AttackResult): AiObservation {
  if (result.kind === 'DESTROYED') {
    return {
      position: { ...position },
      kind: result.kind,
      revealedCells: result.revealedCells.map((cell) => ({ ...cell, position: { ...cell.position } })),
    };
  }
  return { position: { ...position }, kind: result.kind };
}

export function createAiSession(
  humanFleet: Plane[],
  difficulty: AiDifficulty,
  options: CreateAiSessionOptions = {},
): AiSessionState {
  if (humanFleet.length !== 3 || !validatePlacement(humanFleet).valid) {
    throw new AiSessionError('INVALID_HUMAN_FLEET', 'Human player must deploy exactly three legal planes.');
  }

  const random = options.random ?? Math.random;
  const aiFleet = options.aiFleet ?? randomFleet('ai', random);
  if (aiFleet.length !== 3 || !validatePlacement(aiFleet).valid) {
    throw new AiSessionError('INVALID_AI_FLEET', 'AI fleet must contain exactly three legal planes.');
  }

  const firstPlayerId = options.firstPlayerId ?? (random() < 0.5 ? 'HUMAN' : 'AI');
  return {
    difficulty,
    game: createGame([
      { id: 'HUMAN', planes: humanFleet },
      { id: 'AI', planes: aiFleet },
    ], firstPlayerId),
    aiObservations: [],
    random,
  };
}

export function humanAttack(session: AiSessionState, position: Position): HumanAttackOutcome {
  if (session.game.currentPlayerId !== 'HUMAN') {
    throw new AiSessionError('NOT_HUMAN_TURN', 'It is not the human player turn.');
  }
  const outcome = attack(session.game, position);
  return {
    session: {
      ...session,
      game: outcome.game,
      aiObservations: session.aiObservations.map(cloneObservation),
    },
    result: outcome.result,
  };
}

export function runAiTurn(session: AiSessionState): AiTurnOutcome {
  if (session.game.currentPlayerId !== 'AI') {
    throw new AiSessionError('NOT_AI_TURN', 'It is not the AI turn.');
  }
  const position = chooseAiAttack(session.difficulty, session.aiObservations, session.random);
  const outcome = attack(session.game, position);
  const observation = toObservation(position, outcome.result);
  return {
    session: {
      ...session,
      game: outcome.game,
      aiObservations: [...session.aiObservations.map(cloneObservation), observation],
    },
    result: outcome.result,
    position,
  };
}
