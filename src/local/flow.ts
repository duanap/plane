export type LocalPlayerId = 'A' | 'B';

export type LocalFlowState =
  | { stage: 'SETUP' }
  | { stage: 'PLACEMENT_A' }
  | { stage: 'HANDOFF_B' }
  | { stage: 'PLACEMENT_B' }
  | { stage: 'HANDOFF_BATTLE' }
  | { stage: 'HANDOFF_TURN'; nextPlayer: LocalPlayerId }
  | { stage: 'PLAYING'; activePlayer: LocalPlayerId }
  | { stage: 'TURN_RESULT'; activePlayer: LocalPlayerId; nextPlayer: LocalPlayerId }
  | { stage: 'FINISHED' };

export function beginLocalFlow(): LocalFlowState {
  return { stage: 'SETUP' };
}

export function confirmPlacement(
  state: { stage: 'PLACEMENT_A' } | { stage: 'PLACEMENT_B' },
): LocalFlowState {
  return state.stage === 'PLACEMENT_A'
    ? { stage: 'HANDOFF_B' }
    : { stage: 'HANDOFF_BATTLE' };
}

export function startSecondPlacement(state: { stage: 'HANDOFF_B' }): LocalFlowState {
  void state;
  return { stage: 'PLACEMENT_B' };
}

export function startBattle(
  state: { stage: 'HANDOFF_BATTLE' },
  firstPlayer: LocalPlayerId,
): LocalFlowState {
  void state;
  return { stage: 'HANDOFF_TURN', nextPlayer: firstPlayer };
}

export function openTurn(
  state: { stage: 'HANDOFF_TURN'; nextPlayer: LocalPlayerId },
): LocalFlowState {
  return { stage: 'PLAYING', activePlayer: state.nextPlayer };
}

export function recordAttackResult(
  state: { stage: 'PLAYING'; activePlayer: LocalPlayerId },
  nextPlayer: LocalPlayerId,
  finished: boolean,
): LocalFlowState {
  if (finished) return { stage: 'FINISHED' };
  return { stage: 'TURN_RESULT', activePlayer: state.activePlayer, nextPlayer };
}

export function endTurn(
  state: { stage: 'TURN_RESULT'; activePlayer: LocalPlayerId; nextPlayer: LocalPlayerId },
): LocalFlowState {
  return { stage: 'HANDOFF_TURN', nextPlayer: state.nextPlayer };
}
