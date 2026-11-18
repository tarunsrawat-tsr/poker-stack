export const ROUND_NAMES = ["Pre-flop", "Flop", "Turn", "River"] as const;

export type GamePhase = "setup" | "playing" | "gameOver";
export type WinReason = "target" | "lastStanding";
export type SeatRole = "starting" | "big" | "small";

export interface RoleSelection {
  startIndex: number;
  bigIndex: number;
  smallIndex: number;
}

export interface Player {
  id: string;
  name: string;
  balance: number;
  roundBet: number;
  handBet: number;
  folded: boolean;
  sittingOut: boolean;
}

export interface HandResult {
  handNumber: number;
  winnerId: string;
  winnerName: string;
  pot: number;
  reason: "fold" | "showdown";
}

export interface BalanceAdjustment {
  id: string;
  handNumber: number;
  playerId: string;
  playerName: string;
  previousBalance: number;
  newBalance: number;
  timestamp: number;
}

export interface HandStepSnapshot {
  snapshotId: string;
  handNumber: number;
  roundIndex: number;
  roundName: string;
  actorId: string;
  actorName: string;
  actionKind: "match" | "raise" | "fold" | "adjust";
  actionAmount?: number;
  summary: string;
  timestamp: number;
  beforeState: {
    players: Player[];
    pot: number;
    highestBet: number;
    roundIndex: number;
    currentTurnId: string | null;
    actedIds: string[];
    turnOrder: number[];
    netAdjustments?: number;
    adjustmentCount?: number;
  };
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  startingAmount: number;
  handNumber: number;
  startIndex: number;
  bigIndex: number;
  smallIndex: number;
  turnOrder: number[];
  roundIndex: number;
  bigBlind: number;
  smallBlind: number;
  highestBet: number;
  pot: number;
  currentTurnId: string | null;
  actedIds: string[];
  history: HandResult[];
  balanceAdjustments: BalanceAdjustment[];
  netAdjustments: number;
  lastResult: HandResult | null;
  winnerId: string | null;
  winReason: WinReason | null;
  handSnapshots: HandStepSnapshot[];
  previousHandState: GameState | null;
}

export type GameAction =
  | {
      type: "START";
      names: string[];
      startingAmount: number;
      startIndex?: number;
      bigIndex?: number;
      smallIndex?: number;
    }
  | {
      type: "SET_ROLES";
      startIndex: number;
      bigIndex: number;
      smallIndex: number;
    }
  | {
      type: "ACT";
      kind: "match" | "raise" | "fold";
      playerId: string;
      handNumber: number;
      roundIndex: number;
      amount?: number;
    }
  | {
      type: "ADJUST_BALANCE";
      playerId: string;
      handNumber: number;
      amount: number;
    }
  | {
      type: "ROLLBACK_TO_SNAPSHOT";
      snapshotId: string;
    }
  | {
      type: "EDIT_ACTION";
      snapshotId: string;
      kind: "match" | "raise" | "fold";
      amount?: number;
    }
  | {
      type: "UNDO_LAST_ACTION";
    }
  | {
      type: "UNDO_HAND_RESULT";
    }
  | {
      type: "SHOWDOWN";
      winnerId: string;
      handNumber: number;
      nextRoles?: RoleSelection;
    }
  | { type: "DISMISS_RESULT" }
  | { type: "RESET" };

export const INITIAL_GAME: GameState = {
  phase: "setup",
  players: [],
  startingAmount: 1000,
  handNumber: 0,
  startIndex: 0,
  bigIndex: 1,
  smallIndex: 2,
  turnOrder: [],
  roundIndex: 0,
  bigBlind: 100,
  smallBlind: 50,
  highestBet: 0,
  pot: 0,
  currentTurnId: null,
  actedIds: [],
  history: [],
  balanceAdjustments: [],
  netAdjustments: 0,
  lastResult: null,
  winnerId: null,
  winReason: null,
  handSnapshots: [],
  previousHandState: null,
};

export function defaultRoles(playerCount: number): RoleSelection {
  if (playerCount < 3) {
    return { startIndex: 0, bigIndex: 1, smallIndex: 2 };
  }
  return {
    startIndex: 0,
    bigIndex: playerCount - 2,
    smallIndex: playerCount - 1,
  };
}

export function isValidRoleSelection(playerCount: number, roles: RoleSelection): boolean {
  const { startIndex, bigIndex, smallIndex } = roles;
  return (
    playerCount >= 3 &&
    Number.isInteger(startIndex) &&
    Number.isInteger(bigIndex) &&
    Number.isInteger(smallIndex) &&
    startIndex >= 0 &&
    startIndex < playerCount &&
    bigIndex >= 0 &&
    bigIndex < playerCount &&
    smallIndex >= 0 &&
    smallIndex < playerCount &&
    bigIndex !== smallIndex
  );
}

export function isValidHandRoles(players: Player[], roles: RoleSelection): boolean {
  const funded = players
    .map((player, index) => player.balance > 0 ? index : -1)
    .filter((index) => index !== -1);

  return funded.length >= 2 &&
    isValidRoleSelection(players.length, roles) &&
    [roles.startIndex, roles.bigIndex, roles.smallIndex].every((index) => funded.includes(index));
}

/**
 * Each player acts once: Starter first, then non-blind seats, then any blind
 * holders who have not already acted. Start can also hold either blind.
 */
export function buildTurnOrder(
  playerCount: number,
  startIndex: number,
  bigIndex: number,
  smallIndex: number,
): number[] {
  if (playerCount <= 0) return [];
  const order: number[] = [startIndex];
  for (let offset = 1; offset < playerCount; offset++) {
    const index = (startIndex + offset) % playerCount;
    if (index !== startIndex && index !== bigIndex && index !== smallIndex) {
      order.push(index);
    }
  }
  if (!order.includes(bigIndex) && bigIndex >= 0 && bigIndex < playerCount) {
    order.push(bigIndex);
  }
  if (!order.includes(smallIndex) && smallIndex >= 0 && smallIndex < playerCount) {
    order.push(smallIndex);
  }
  return order;
}

export function getSeatRole(
  index: number,
  state: Pick<GameState, "startIndex" | "bigIndex" | "smallIndex">,
): SeatRole | null {
  return getSeatRoles(index, state)[0] ?? null;
}

export function getSeatRoles(
  index: number,
  state: Pick<GameState, "startIndex" | "bigIndex" | "smallIndex">,
): SeatRole[] {
  const roles: SeatRole[] = [];
  if (index === state.startIndex) roles.push("starting");
  if (index === state.bigIndex) roles.push("big");
  if (index === state.smallIndex) roles.push("small");
  return roles;
}

export function isInHand(player: Player): boolean {
  return !player.folded && !player.sittingOut;
}

export function canAct(player: Player): boolean {
  return isInHand(player) && player.balance > 0;
}

function nextActor(
  players: Player[],
  turnOrder: number[],
  fromPlayerIndex: number,
  includeCurrent = false,
): string | null {
  if (turnOrder.length === 0) return null;
  const startPos = Math.max(0, turnOrder.indexOf(fromPlayerIndex));
  const startStep = includeCurrent ? 0 : 1;
  const maxStep = turnOrder.length + (includeCurrent ? 0 : 1);

  for (let step = startStep; step < maxStep; step++) {
    const playerIndex = turnOrder[(startPos + step) % turnOrder.length];
    const player = players[playerIndex];
    if (player && canAct(player)) return player.id;
  }
  return null;
}

function checkTarget(state: GameState): GameState {
  const target = (state.players.length - 1) * state.startingAmount;
  const winner = state.players.find((player) => player.balance === target);

  return winner
    ? { ...state, phase: "gameOver", winnerId: winner.id, winReason: "target", currentTurnId: null }
    : state;
}

function prepareHand(state: GameState): GameState {
  // Only players with no chips before blinds are out. All-in players can still win this hand.
  const eliminated = state.players.filter((player) => player.balance === 0).length;
  const bigBlind = 100 * 2 ** eliminated;
  const smallBlind = bigBlind / 2;
  const { startIndex, bigIndex, smallIndex } = state;
  const turnOrder = buildTurnOrder(state.players.length, startIndex, bigIndex, smallIndex);

  const players = state.players.map((player) => ({
    ...player,
    roundBet: 0,
    handBet: 0,
    folded: false,
    sittingOut: player.balance === 0,
  }));

  let pot = 0;
  const postBlind = (index: number, blind: number) => {
    const player = players[index];
    if (!player || player.sittingOut) return;

    // A short stack posts only the chips it has, and remains eligible at showdown.
    const posted = Math.min(player.balance, blind);
    players[index] = {
      ...player,
      balance: player.balance - posted,
      roundBet: posted,
      handBet: posted,
    };
    pot += posted;
  };

  postBlind(bigIndex, bigBlind);
  postBlind(smallIndex, smallBlind);

  return checkTarget({
    ...state,
    phase: "playing",
    players,
    turnOrder,
    roundIndex: 0,
    bigBlind,
    smallBlind,
    highestBet: Math.max(players[bigIndex]?.roundBet ?? 0, players[smallIndex]?.roundBet ?? 0),
    pot,
    currentTurnId: nextActor(players, turnOrder, startIndex, true),
    actedIds: [],
    winnerId: null,
    winReason: null,
    handSnapshots: [],
    previousHandState: state.previousHandState ?? (state.phase === "playing" ? state : null),
  });
}

export function nextHandRoles(
  state: Pick<GameState, "players" | "startIndex" | "bigIndex" | "smallIndex" | "turnOrder">,
): RoleSelection {
  const count = state.players.length;
  const currentOrder =
    state.turnOrder.length === count && new Set(state.turnOrder).size === count
      ? state.turnOrder
      : buildTurnOrder(count, state.startIndex, state.bigIndex, state.smallIndex);
  // Rotate each token independently: Start can hold a blind, so the final
  // positions in the action order do not always identify Big and Small.
  const nextSeat = (index: number) => currentOrder[(currentOrder.indexOf(index) + 1) % count];
  const startCandidate = nextSeat(state.startIndex);
  const bigCandidate = nextSeat(state.bigIndex);
  const smallCandidate = nextSeat(state.smallIndex);
  const fundedCount = state.players.filter((player) => player.balance > 0).length;
  if (fundedCount < 2) {
    return {
      startIndex: startCandidate,
      bigIndex: bigCandidate,
      smallIndex: smallCandidate,
    };
  }

  const nextFunded = (candidate: number, assigned: number[] = []): number => {
    const position = currentOrder.indexOf(candidate);
    for (let offset = 0; offset < count; offset++) {
      const index = currentOrder[(position + offset) % count];
      if (state.players[index].balance > 0 && !assigned.includes(index)) return index;
    }
    return -1;
  };

  const startIndex = nextFunded(startCandidate);
  const bigIndex = nextFunded(bigCandidate);

  return {
    startIndex,
    bigIndex,
    smallIndex: nextFunded(smallCandidate, [bigIndex]),
  };
}

function completeHand(
  state: GameState,
  winnerId: string,
  reason: HandResult["reason"],
  customNextRoles?: RoleSelection,
): GameState {
  const winner = state.players.find((player) => player.id === winnerId);
  if (!winner || !isInHand(winner)) return state;

  const result: HandResult = {
    handNumber: state.handNumber,
    winnerId,
    winnerName: winner.name,
    pot: state.pot,
    reason,
  };
  const players = state.players.map((player) =>
    player.id === winnerId ? { ...player, balance: player.balance + state.pot } : player,
  );
  const settled = checkTarget({
    ...state,
    players,
    pot: 0,
    currentTurnId: null,
    history: [result, ...state.history],
    lastResult: result,
    previousHandState: { ...state, previousHandState: null },
  });

  if (settled.phase === "gameOver") return settled;

  const funded = players.filter((player) => player.balance > 0);
  if (funded.length === 1) {
    return {
      ...settled,
      phase: "gameOver",
      winnerId: funded[0].id,
      winReason: "lastStanding",
    };
  }

  const roles = customNextRoles && isValidHandRoles(players, customNextRoles)
    ? customNextRoles
    : nextHandRoles({ ...state, players });

  return prepareHand({
    ...settled,
    handNumber: state.handNumber + 1,
    ...roles,
  });
}

function snapshotBefore(state: GameState): HandStepSnapshot["beforeState"] {
  return {
    players: state.players.map((player) => ({ ...player })),
    pot: state.pot,
    highestBet: state.highestBet,
    roundIndex: state.roundIndex,
    currentTurnId: state.currentTurnId,
    actedIds: [...state.actedIds],
    turnOrder: [...state.turnOrder],
    netAdjustments: state.netAdjustments,
    adjustmentCount: state.balanceAdjustments.length,
  };
}

function restoreBeforeSnapshot(state: GameState, index: number): GameState {
  const before = state.handSnapshots[index].beforeState;
  return {
    ...state,
    phase: "playing",
    players: before.players.map((player) => ({ ...player })),
    pot: before.pot,
    highestBet: before.highestBet,
    roundIndex: before.roundIndex,
    currentTurnId: before.currentTurnId,
    actedIds: [...before.actedIds],
    turnOrder: [...before.turnOrder],
    netAdjustments: before.netAdjustments ?? 0,
    balanceAdjustments: state.balanceAdjustments.slice(0, before.adjustmentCount ?? 0),
    handSnapshots: state.handSnapshots.slice(0, index),
    lastResult: null,
    winnerId: null,
    winReason: null,
  };
}

function takeAction(state: GameState, action: Extract<GameAction, { type: "ACT" }>): GameState {
  if (
    state.phase !== "playing" ||
    state.currentTurnId !== action.playerId ||
    state.handNumber !== action.handNumber ||
    state.roundIndex !== action.roundIndex
  ) {
    return state;
  }

  const index = state.players.findIndex((player) => player.id === action.playerId);
  const actor = state.players[index];
  if (!actor || !canAct(actor)) return state;

  const turnOrder =
    state.turnOrder.length === state.players.length
      ? state.turnOrder
      : buildTurnOrder(state.players.length, state.startIndex, state.bigIndex, state.smallIndex);

  const players = state.players.map((p) => ({ ...p }));
  let pot = state.pot;
  let highestBet = state.highestBet;
  let actedIds = [...state.actedIds];

  let actionSummary = "";
  if (action.kind === "fold") {
    players[index] = { ...actor, folded: true };
    actionSummary = "Folded";
  } else {
    let contribution: number;
    if (action.kind === "raise") {
      if (!Number.isSafeInteger(action.amount) || action.amount! <= highestBet) return state;
      contribution = action.amount! - actor.roundBet;
      if (contribution <= 0 || contribution > actor.balance) return state;
      highestBet = action.amount!;
      actedIds = [actor.id];
      actionSummary = `Raised to ${action.amount}`;
    } else {
      const needed = Math.max(0, highestBet - actor.roundBet);
      contribution = Math.min(needed, actor.balance);
      actedIds = [...actedIds, actor.id];
      actionSummary = needed === 0 ? "Checked" : `Matched ${contribution}`;
    }

    players[index] = {
      ...actor,
      balance: actor.balance - contribution,
      roundBet: actor.roundBet + contribution,
      handBet: actor.handBet + contribution,
    };
    pot += contribution;
  }

  const snapshot: HandStepSnapshot = {
    snapshotId: `snap-${state.handNumber}-${state.roundIndex}-${actor.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    handNumber: state.handNumber,
    roundIndex: state.roundIndex,
    roundName: ROUND_NAMES[state.roundIndex],
    actorId: actor.id,
    actorName: actor.name,
    actionKind: action.kind,
    actionAmount: action.amount,
    summary: actionSummary,
    timestamp: Date.now(),
    beforeState: snapshotBefore(state),
  };

  const updatedSnapshots = [...(state.handSnapshots || []), snapshot];

  const updated = checkTarget({
    ...state,
    players,
    turnOrder,
    pot,
    highestBet,
    actedIds,
    lastResult: null,
    handSnapshots: updatedSnapshots,
  });
  if (updated.phase === "gameOver") return updated;

  const remaining = players.filter(isInHand);
  if (remaining.length === 1) return completeHand(updated, remaining[0].id, "fold");

  // Everyone gets an opportunity to act, including a big blind who can check.
  // All-in players are exempt from matching a bet they cannot cover.
  const roundComplete = remaining.every(
    (player) => player.balance === 0 || (player.roundBet === highestBet && actedIds.includes(player.id)),
  );

  if (roundComplete) {
    if (state.roundIndex === ROUND_NAMES.length - 1) {
      return { ...updated, currentTurnId: null };
    }

    const nextPlayers = players.map((player) => ({ ...player, roundBet: 0 }));
    return {
      ...updated,
      players: nextPlayers,
      roundIndex: state.roundIndex + 1,
      highestBet: 0,
      actedIds: [],
      currentTurnId: nextActor(nextPlayers, turnOrder, state.startIndex, true),
    };
  }

  return { ...updated, currentTurnId: nextActor(players, turnOrder, index) };
}

function adjustBalance(
  state: GameState,
  action: Extract<GameAction, { type: "ADJUST_BALANCE" }>,
): GameState {
  if (
    state.phase !== "playing" ||
    state.handNumber !== action.handNumber ||
    !Number.isSafeInteger(action.amount) ||
    action.amount < 0
  ) return state;

  const index = state.players.findIndex((player) => player.id === action.playerId);
  const player = state.players[index];
  if (!player || player.balance === action.amount) return state;

  const delta = action.amount - player.balance;
  const total = state.players.reduce((sum, current) => sum + current.balance, state.pot);
  if (
    !Number.isSafeInteger(total + delta) ||
    !Number.isSafeInteger(state.netAdjustments + delta)
  ) return state;

  const players = state.players.map((current, playerIndex) =>
    playerIndex === index
      ? {
          ...current,
          balance: action.amount,
          // Previously eliminated players rejoin on the next hand, not mid-round.
          sittingOut: current.sittingOut || (action.amount === 0 && current.handBet === 0),
        }
      : current,
  );
  if (!players.some(isInHand)) return state;

  const timestamp = Date.now();
  const id = `adjust-${state.handNumber}-${player.id}-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
  const snapshot: HandStepSnapshot = {
    snapshotId: id,
    handNumber: state.handNumber,
    roundIndex: state.roundIndex,
    roundName: ROUND_NAMES[state.roundIndex],
    actorId: player.id,
    actorName: player.name,
    actionKind: "adjust",
    actionAmount: action.amount,
    summary: `Stack ${player.balance} to ${action.amount}`,
    timestamp,
    beforeState: snapshotBefore(state),
  };

  const adjusted = checkTarget({
    ...state,
    players,
    netAdjustments: state.netAdjustments + delta,
    balanceAdjustments: [
      ...state.balanceAdjustments,
      {
        id,
        handNumber: state.handNumber,
        playerId: player.id,
        playerName: player.name,
        previousBalance: player.balance,
        newBalance: action.amount,
        timestamp,
      },
    ],
    handSnapshots: [...state.handSnapshots, snapshot],
    lastResult: null,
  });
  if (adjusted.phase === "gameOver") return adjusted;

  const remaining = players.filter(isInHand);
  if (remaining.length === 1) return completeHand(adjusted, remaining[0].id, "fold");

  const roundComplete = remaining.every(
    (current) =>
      current.balance === 0 ||
      (current.roundBet === state.highestBet && state.actedIds.includes(current.id)),
  );
  if (roundComplete) {
    if (state.roundIndex === ROUND_NAMES.length - 1) {
      return { ...adjusted, currentTurnId: null };
    }
    const nextPlayers = players.map((current) => ({ ...current, roundBet: 0 }));
    return {
      ...adjusted,
      players: nextPlayers,
      roundIndex: state.roundIndex + 1,
      highestBet: 0,
      actedIds: [],
      currentTurnId: nextActor(nextPlayers, state.turnOrder, state.startIndex, true),
    };
  }

  const currentActor = players.find((current) => current.id === state.currentTurnId);
  if (currentActor && canAct(currentActor)) return adjusted;

  const previousIndex = currentActor ? players.indexOf(currentActor) : state.startIndex;
  return {
    ...adjusted,
    currentTurnId: nextActor(players, state.turnOrder, previousIndex, !currentActor),
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "START": {
      const names = action.names.map((name) => name.trim());
      if (
        state.phase !== "setup" ||
        names.length < 3 ||
        names.some((name) => !name) ||
        new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
        !Number.isSafeInteger(action.startingAmount) ||
        action.startingAmount < 1 ||
        !Number.isSafeInteger(action.startingAmount * names.length)
      ) {
        return state;
      }

      const defaults = defaultRoles(names.length);
      const roles: RoleSelection = {
        startIndex: action.startIndex ?? defaults.startIndex,
        bigIndex: action.bigIndex ?? defaults.bigIndex,
        smallIndex: action.smallIndex ?? defaults.smallIndex,
      };
      if (!isValidRoleSelection(names.length, roles)) {
        return state;
      }

      const players: Player[] = names.map((name, index) => ({
        id: String(index),
        name,
        balance: action.startingAmount,
        roundBet: 0,
        handBet: 0,
        folded: false,
        sittingOut: false,
      }));

      const turnOrder = buildTurnOrder(
        names.length,
        roles.startIndex,
        roles.bigIndex,
        roles.smallIndex,
      );

      return prepareHand({
        ...INITIAL_GAME,
        players,
        startingAmount: action.startingAmount,
        handNumber: 1,
        startIndex: roles.startIndex,
        bigIndex: roles.bigIndex,
        smallIndex: roles.smallIndex,
        turnOrder,
        handSnapshots: [],
        previousHandState: null,
      });
    }
    case "SET_ROLES": {
      if (
        state.phase !== "playing" ||
        state.roundIndex !== 0 ||
        state.actedIds.length > 0 ||
        state.handSnapshots.length > 0
      ) {
        return state;
      }

      const refundedPlayers = state.players.map((player) => ({
        ...player,
        balance: player.balance + player.handBet,
        roundBet: 0,
        handBet: 0,
        folded: false,
      }));
      if (!isValidHandRoles(refundedPlayers, action)) return state;
      const turnOrder = buildTurnOrder(
        refundedPlayers.length,
        action.startIndex,
        action.bigIndex,
        action.smallIndex,
      );

      return prepareHand({
        ...state,
        players: refundedPlayers,
        pot: 0,
        startIndex: action.startIndex,
        bigIndex: action.bigIndex,
        smallIndex: action.smallIndex,
        turnOrder,
        handSnapshots: [],
      });
    }
    case "ACT":
      return takeAction(state, action);
    case "ADJUST_BALANCE":
      return adjustBalance(state, action);
    case "ROLLBACK_TO_SNAPSHOT": {
      if (state.phase !== "playing" || !state.handSnapshots) return state;
      const snapshotIndex = state.handSnapshots.findIndex((s) => s.snapshotId === action.snapshotId);
      if (snapshotIndex === -1) return state;
      return restoreBeforeSnapshot(state, snapshotIndex);
    }
    case "EDIT_ACTION": {
      if (state.phase !== "playing" || !state.handSnapshots) return state;
      const snapshotIndex = state.handSnapshots.findIndex((s) => s.snapshotId === action.snapshotId);
      if (snapshotIndex === -1) return state;

      const target = state.handSnapshots[snapshotIndex];
      if (target.actionKind === "adjust") return state;
      const rolledBackState = restoreBeforeSnapshot(state, snapshotIndex);

      const corrected = takeAction(rolledBackState, {
        type: "ACT",
        playerId: target.actorId,
        handNumber: rolledBackState.handNumber,
        roundIndex: rolledBackState.roundIndex,
        kind: action.kind,
        amount: action.amount,
      });
      return corrected === rolledBackState ? state : corrected;
    }
    case "UNDO_LAST_ACTION": {
      if (!state.handSnapshots || state.handSnapshots.length === 0) {
        return state;
      }
      const lastIndex = state.handSnapshots.length - 1;
      if (
        state.phase !== "playing" &&
        !(state.phase === "gameOver" && state.handSnapshots[lastIndex].actionKind === "adjust")
      ) return state;
      return restoreBeforeSnapshot(state, lastIndex);
    }
    case "UNDO_HAND_RESULT": {
      if (!state.previousHandState) return state;
      return {
        ...state.previousHandState,
        previousHandState: null,
      };
    }
    case "SHOWDOWN":
      return state.phase === "playing" && state.handNumber === action.handNumber
        ? completeHand(state, action.winnerId, "showdown", action.nextRoles)
        : state;
    case "DISMISS_RESULT":
      return { ...state, lastResult: null };
    case "RESET":
      return INITIAL_GAME;
  }
}
