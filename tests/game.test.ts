import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_GAME,
  gameReducer,
  getSeatRoles,
  isValidHandRoles,
  isValidRoleSelection,
  nextHandRoles,
  type GameState,
} from "../src/game";

function start(startingAmount = 1000): GameState {
  return gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo"],
    startingAmount,
  });
}

function act(state: GameState, kind: "match" | "raise" | "fold", amount?: number): GameState {
  return gameReducer(state, {
    type: "ACT",
    playerId: state.currentTurnId!,
    handNumber: state.handNumber,
    roundIndex: state.roundIndex,
    kind,
    amount,
  });
}

function assertChipsConserved(state: GameState) {
  assert.equal(
    state.players.reduce((total, player) => total + player.balance, 0) + state.pot,
    state.players.length * state.startingAmount + state.netAdjustments,
  );
}

function adjust(state: GameState, playerId: string, amount: number): GameState {
  return gameReducer(state, {
    type: "ADJUST_BALANCE",
    playerId,
    handNumber: state.handNumber,
    amount,
  });
}

test("posts blinds and begins with the starting player", () => {
  const state = start();

  assert.equal(state.phase, "playing");
  assert.equal(state.bigBlind, 100);
  assert.equal(state.smallBlind, 50);
  assert.equal(state.highestBet, 100);
  assert.equal(state.pot, 150);
  assert.equal(state.currentTurnId, "0");
  assert.deepEqual(state.players.map((player) => [player.balance, player.roundBet]), [
    [1000, 0], [900, 100], [950, 50],
  ]);
  assertChipsConserved(state);
});

test("the Starter may also be Big or Small, but acts only once per iteration", () => {
  const names = ["Ava", "Beau", "Cleo", "Dan"];
  assert.equal(isValidRoleSelection(4, { startIndex: 2, bigIndex: 2, smallIndex: 3 }), true);
  assert.equal(isValidRoleSelection(4, { startIndex: 3, bigIndex: 2, smallIndex: 3 }), true);
  assert.equal(isValidRoleSelection(4, { startIndex: 2, bigIndex: 2, smallIndex: 2 }), false);

  for (const [startIndex, expectedOrder] of [
    [2, [2, 0, 1, 3]],
    [3, [3, 0, 1, 2]],
  ] as const) {
    let state = gameReducer(INITIAL_GAME, {
      type: "START", names, startingAmount: 1000,
      startIndex, bigIndex: 2, smallIndex: 3,
    });
    assert.deepEqual(state.turnOrder, expectedOrder);
    assert.equal(state.players[2].roundBet, 100);
    assert.equal(state.players[3].roundBet, 50);
    assert.equal(state.pot, 150);
    assert.equal(state.currentTurnId, String(startIndex));
    assert.deepEqual(getSeatRoles(startIndex, state), startIndex === 2
      ? ["starting", "big"]
      : ["starting", "small"]);

    const actors: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      actors.push(state.currentTurnId!);
      state = act(state, "match");
    }
    assert.deepEqual(actors, expectedOrder.map(String));
    assert.equal(state.roundIndex, 1);
    assert.equal(state.currentTurnId, String(startIndex));
    assertChipsConserved(state);
  }
});

test("overlapping Start and blind tokens rotate independently between hands", () => {
  const names = ["Ava", "Beau", "Cleo", "Dan"];
  for (const [currentStart, expected] of [
    [2, { startIndex: 0, bigIndex: 0, smallIndex: 2 }],
    [3, { startIndex: 0, bigIndex: 3, smallIndex: 0 }],
  ] as const) {
    const state = gameReducer(INITIAL_GAME, {
      type: "START", names, startingAmount: 1000,
      startIndex: currentStart, bigIndex: 2, smallIndex: 3,
    });
    assert.deepEqual(nextHandRoles(state), expected);

    const next = gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 });
    assert.equal(next.startIndex, expected.startIndex);
    assert.equal(next.bigIndex, expected.bigIndex);
    assert.equal(next.smallIndex, expected.smallIndex);
    assert.equal(next.players[next.bigIndex].roundBet, 100);
    assert.equal(next.players[next.smallIndex].roundBet, 50);
    assert.equal(next.pot, 150);
    assertChipsConserved(next);
  }
});

test("offers the big blind a turn, advances all rounds, and rotates after a payout", () => {
  let state = start();

  state = act(state, "match");
  assert.equal(state.currentTurnId, "1");
  state = act(state, "match");
  assert.equal(state.currentTurnId, "2");
  state = act(state, "match");
  assert.equal(state.roundIndex, 1);
  assert.equal(state.pot, 300);
  assert.deepEqual(state.players.map((player) => player.roundBet), [0, 0, 0]);

  for (let turn = 0; turn < 9; turn++) state = act(state, "match");
  assert.equal(state.roundIndex, 3);
  assert.equal(state.currentTurnId, null);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 });
  assert.equal(state.phase, "playing");
  assert.equal(state.handNumber, 2);
  assert.equal(state.startIndex, 1);
  assert.equal(state.currentTurnId, "1");
  assert.equal(state.history[0].pot, 300);
  assert.equal(state.history[0].winnerName, "Ava");
  assert.equal(state.players[0].balance, 1150);
  assertChipsConserved(state);
});

test("raises are total round bets and cannot exceed the stack", () => {
  let state = start();
  const invalidLow = act(state, "raise", 100);
  const invalidHigh = act(state, "raise", 2000);
  assert.strictEqual(invalidLow, state);
  assert.strictEqual(invalidHigh, state);

  state = act(state, "raise", 150);
  assert.equal(state.players[0].balance, 850);
  assert.equal(state.players[0].roundBet, 150);
  assert.equal(state.highestBet, 150);
  assert.equal(state.pot, 300);
  state = act(state, "match");
  state = act(state, "match");
  assert.equal(state.roundIndex, 1);
  assert.equal(state.pot, 450);
  assertChipsConserved(state);
});

test("folds leave contributions in the pot and award it automatically", () => {
  let state = start();
  state = act(state, "fold");
  state = act(state, "match");
  state = act(state, "fold");

  assert.equal(state.handNumber, 2);
  assert.equal(state.history[0].winnerName, "Beau");
  assert.equal(state.history[0].reason, "fold");
  assert.equal(state.history[0].pot, 150);
  assertChipsConserved(state);
});

test("short stacks go all-in without negative balances or blocking showdown", () => {
  let state = start(60);
  assert.deepEqual(state.players.map((player) => player.balance), [60, 0, 10]);
  state = act(state, "match");
  state = act(state, "match");
  assert.equal(state.pot, 180);
  assert.equal(state.currentTurnId, null);
  assertChipsConserved(state);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "1", handNumber: 1 });
  assert.equal(state.phase, "gameOver");
  assert.equal(state.winReason, "lastStanding");
  assert.equal(state.players[1].balance, 180);
});

test("zero-balance players sit out and increase the next big blind", () => {
  let state = start(100);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 });

  assert.equal(state.phase, "playing");
  assert.equal(state.bigBlind, 200);
  assert.equal(state.smallBlind, 100);
  assert.equal(state.players[1].sittingOut, true);
  assert.equal(state.startIndex, 2);
  assert.equal(state.bigIndex, 2);
  assert.equal(state.smallIndex, 0);
  assert.equal(state.players[2].roundBet, 50);
  assert.equal(state.players[0].roundBet, 100);
  assert.equal(state.currentTurnId, "0");
  assertChipsConserved(state);
});

test("each eliminated player doubles the big blind on the next hand", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli"],
    startingAmount: 1000,
  });
  assert.equal(state.bigBlind, 100);
  assert.equal(state.smallBlind, 50);

  // Eli has posted the small blind: zero now means all-in, not eliminated mid-hand.
  state = adjust(state, "4", 0);
  assert.equal(state.bigBlind, 100);
  assert.equal(state.players[4].sittingOut, false);
  assert.equal(state.players[4].handBet, 50);
  assert.equal(state.pot, 150);
  assertChipsConserved(state);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 });
  assert.equal(state.bigBlind, 200);
  assert.equal(state.smallBlind, 100);
  assert.equal(state.players[4].sittingOut, true);

  // Dan has not put chips in this hand; zero removes him from this hand too.
  state = adjust(state, "3", 0);
  assert.equal(state.bigBlind, 200);
  assert.equal(state.players[3].sittingOut, true);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "1", handNumber: 2 });
  assert.equal(state.bigBlind, 400);
  assert.equal(state.smallBlind, 200);
  assert.equal(state.players[state.bigIndex].roundBet, 400);
  assert.equal(state.players[state.smallIndex].roundBet, 200);
  assert.equal(state.players[3].sittingOut, true);
  assert.equal(state.players[4].sittingOut, true);
  assertChipsConserved(state);
});

test("an eliminated next Big is skipped and the next funded player receives Big", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli"],
    startingAmount: 1000,
  });
  state = adjust(state, "4", 0);

  const projectedPlayers = state.players.map((player) =>
    player.id === "0" ? { ...player, balance: player.balance + state.pot } : player,
  );
  assert.deepEqual(nextHandRoles({ ...state, players: projectedPlayers }), {
    startIndex: 1,
    bigIndex: 0,
    smallIndex: 1,
  });

  const invalidChoice = gameReducer(state, {
    type: "SHOWDOWN", winnerId: "0", handNumber: 1,
    nextRoles: { startIndex: 1, bigIndex: 4, smallIndex: 0 },
  });
  assert.equal(invalidChoice.bigIndex, 0);
  assert.equal(invalidChoice.smallIndex, 1);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 });
  assert.equal(state.startIndex, 1);
  assert.equal(state.bigIndex, 0);
  assert.equal(state.smallIndex, 1);
  assert.deepEqual(getSeatRoles(1, state), ["starting", "small"]);
  assert.deepEqual(state.turnOrder, [1, 2, 3, 4, 0]);
  assert.equal(state.players[4].sittingOut, true);
  assert.equal(state.players[0].roundBet, 200);
  assert.equal(state.players[1].roundBet, 100);
  assert.equal(state.pot, 300);
  assertChipsConserved(state);
});

test("an eliminated blind successor passes its role to a funded Starter", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli"],
    startingAmount: 1000,
    startIndex: 1,
    bigIndex: 0,
    smallIndex: 1,
  });
  state = adjust(state, "1", 0);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "3", handNumber: 1 });

  assert.equal(state.startIndex, 2);
  assert.equal(state.bigIndex, 2);
  assert.equal(state.smallIndex, 3);
  assert.equal(state.players[1].sittingOut, true);
  assert.equal(state.players[2].roundBet, 200);
  assert.equal(state.players[3].roundBet, 100);
  assert.equal(state.currentTurnId, "2");
  assertChipsConserved(state);
});

test("an eliminated next Small is skipped while a funded Big keeps the blind", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli"],
    startingAmount: 1000,
  });
  state = adjust(state, "0", 0);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "1", handNumber: 1 });

  assert.equal(state.startIndex, 1);
  assert.equal(state.bigIndex, 4);
  assert.equal(state.smallIndex, 1);
  assert.equal(state.players[4].roundBet, 200);
  assert.equal(state.players[1].roundBet, 100);
  assert.equal(state.players[0].sittingOut, true);
  assertChipsConserved(state);
});

test("skips both eliminated blind candidates without assigning either title to an out player", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli", "Finn"],
    startingAmount: 1000,
  });
  state = adjust(state, "5", 0);
  state = adjust(state, "0", 0);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "4", handNumber: 1 });

  assert.equal(state.startIndex, 1);
  assert.equal(state.bigIndex, 1);
  assert.equal(state.smallIndex, 2);
  assert.equal(state.bigBlind, 400);
  assert.equal(state.smallBlind, 200);
  assert.equal(state.players[1].roundBet, 400);
  assert.equal(state.players[2].roundBet, 200);
  assert.deepEqual(state.players.filter((player) => player.sittingOut).map((player) => player.id), ["0", "5"]);
  assertChipsConserved(state);
});

test("two survivors still post both blinds and act Starter/Small then Big each round", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan"],
    startingAmount: 1000,
  });
  state = adjust(state, "0", 0);
  state = adjust(state, "1", 0);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "2", handNumber: 1 });

  assert.equal(state.phase, "playing");
  assert.equal(state.startIndex, state.smallIndex);
  assert.equal(state.startIndex, 2);
  assert.equal(state.bigIndex, 3);
  assert.equal(state.smallIndex, 2);
  assert.equal(state.bigBlind, 400);
  assert.equal(state.smallBlind, 200);
  assert.equal(state.players[3].roundBet, 400);
  assert.equal(state.players[2].roundBet, 200);
  assert.equal(state.pot, 600);
  assert.equal(state.highestBet, 400);
  assert.equal(state.currentTurnId, "2");
  assert.deepEqual(getSeatRoles(2, state), ["starting", "small"]);
  assert.equal(isValidHandRoles(state.players.map((player) => ({
    ...player,
    balance: player.balance + player.handBet,
  })), state), true);

  state = act(state, "match");
  assert.equal(state.currentTurnId, "3");
  state = act(state, "match");
  assert.equal(state.roundIndex, 1);
  assert.equal(state.currentTurnId, "2");
  assert.equal(state.pot, 800);
  assertChipsConserved(state);
});

test("head-to-head roles can overlap Start, but Big and Small must stay distinct and funded", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan"],
    startingAmount: 1000,
  });
  state = adjust(state, "0", 0);
  state = adjust(state, "1", 0);
  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "2", handNumber: 1 });

  assert.strictEqual(gameReducer(state, {
    type: "SET_ROLES", startIndex: 3, bigIndex: 2, smallIndex: 2,
  }), state);
  assert.strictEqual(gameReducer(state, {
    type: "SET_ROLES", startIndex: 0, bigIndex: 0, smallIndex: 2,
  }), state);

  const swapped = gameReducer(state, {
    type: "SET_ROLES", startIndex: 2, bigIndex: 2, smallIndex: 3,
  });
  assert.equal(swapped.startIndex, 2);
  assert.equal(swapped.bigIndex, 2);
  assert.equal(swapped.smallIndex, 3);
  assert.equal(swapped.players[2].roundBet, 400);
  assert.equal(swapped.players[3].roundBet, 200);
  assert.equal(swapped.currentTurnId, "2");
  assertChipsConserved(swapped);

  const smallStarts = gameReducer(state, {
    type: "SET_ROLES", startIndex: 3, bigIndex: 2, smallIndex: 3,
  });
  assert.equal(smallStarts.currentTurnId, "3");
  assert.deepEqual(getSeatRoles(3, smallStarts), ["starting", "small"]);
  assert.equal(smallStarts.players[2].roundBet, 400);
  assert.equal(smallStarts.players[3].roundBet, 200);
  assertChipsConserved(smallStarts);
});

test("an all-in player who wins the pot stays eligible for roles next hand", () => {
  let state = start(60);
  assert.equal(state.players[1].balance, 0);
  assert.equal(state.players[1].sittingOut, false);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "1", handNumber: 1 });
  assert.equal(state.phase, "playing");
  assert.equal(state.bigBlind, 100);
  assert.equal(state.players[1].sittingOut, false);
  assert.notEqual(state.bigIndex, state.smallIndex);
  assert.ok(state.players[state.bigIndex].handBet > 0);
  assert.ok(state.players[state.smallIndex].handBet > 0);
  assertChipsConserved(state);
});

test("changing a current player's remaining stack keeps pot and bets intact and advances turn", () => {
  const initial = start();
  const state = adjust(initial, "0", 0);

  assert.equal(state.phase, "playing");
  assert.equal(state.players[0].balance, 0);
  assert.equal(state.players[0].sittingOut, true);
  assert.equal(state.currentTurnId, "1");
  assert.equal(state.bigBlind, 100);
  assert.equal(state.highestBet, 100);
  assert.equal(state.pot, 150);
  assert.deepEqual(state.players.map((player) => player.roundBet), [0, 100, 50]);
  assert.equal(state.netAdjustments, -1000);
  assert.equal(state.balanceAdjustments[0].newBalance, 0);
  assert.equal(state.handSnapshots[0].actionKind, "adjust");
  assertChipsConserved(state);

  // A buy-in restores chips but not eligibility until the next hand.
  const rebought = adjust(state, "0", 300);
  assert.equal(rebought.players[0].balance, 300);
  assert.equal(rebought.players[0].sittingOut, true);
  assert.equal(rebought.currentTurnId, "1");
  assert.equal(rebought.netAdjustments, -700);

  const nextHand = gameReducer(rebought, {
    type: "SHOWDOWN",
    winnerId: "1",
    handNumber: 1,
  });
  assert.equal(nextHand.players[0].sittingOut, false);
  assert.equal(nextHand.bigBlind, 100);
  assertChipsConserved(nextHand);
});

test("manual stack corrections can be undone or rewound without losing earlier corrections", () => {
  const initial = start();
  const corrected = adjust(initial, "1", 777);
  assert.equal(corrected.players[1].balance, 777);
  assert.equal(corrected.players[1].roundBet, 100);
  assert.equal(corrected.pot, 150);
  assert.equal(corrected.netAdjustments, -123);
  assertChipsConserved(corrected);

  assert.strictEqual(
    gameReducer(corrected, {
      type: "EDIT_ACTION",
      snapshotId: corrected.handSnapshots[0].snapshotId,
      kind: "fold",
    }),
    corrected,
  );

  const afterAction = act(corrected, "match");
  const undoneAction = gameReducer(afterAction, {
    type: "ROLLBACK_TO_SNAPSHOT",
    snapshotId: afterAction.handSnapshots[1].snapshotId,
  });
  assert.equal(undoneAction.players[1].balance, 777);
  assert.equal(undoneAction.netAdjustments, -123);
  assert.equal(undoneAction.balanceAdjustments.length, 1);
  assertChipsConserved(undoneAction);

  const undoneCorrection = gameReducer(undoneAction, { type: "UNDO_LAST_ACTION" });
  assert.equal(undoneCorrection.players[1].balance, initial.players[1].balance);
  assert.equal(undoneCorrection.netAdjustments, 0);
  assert.equal(undoneCorrection.balanceAdjustments.length, 0);
  assert.equal(undoneCorrection.handSnapshots.length, 0);
  assertChipsConserved(undoneCorrection);
});

test("rejects invalid stack changes and can undo a corrected stack that triggered game over", () => {
  const initial = start();
  for (const amount of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.strictEqual(adjust(initial, "0", amount), initial);
  }
  assert.strictEqual(adjust(initial, "0", 1000), initial);
  assert.strictEqual(
    gameReducer(initial, { type: "ADJUST_BALANCE", playerId: "0", handNumber: 99, amount: 500 }),
    initial,
  );

  const winning = adjust(initial, "0", 2000);
  assert.equal(winning.phase, "gameOver");
  assert.equal(winning.winReason, "target");
  assert.equal(winning.winnerId, "0");
  assert.equal(winning.pot, initial.pot);
  assertChipsConserved(winning);

  const restored = gameReducer(winning, { type: "UNDO_LAST_ACTION" });
  assert.equal(restored.phase, "playing");
  assert.equal(restored.currentTurnId, initial.currentTurnId);
  assert.equal(restored.players[0].balance, 1000);
  assert.equal(restored.netAdjustments, 0);
  assertChipsConserved(restored);
});

test("declares the exact target balance winner and rejects a folded showdown winner", () => {
  let state = start(100);
  state = act(state, "fold");
  assert.strictEqual(gameReducer(state, { type: "SHOWDOWN", winnerId: "0", handNumber: 1 }), state);

  state = gameReducer(state, { type: "SHOWDOWN", winnerId: "2", handNumber: 1 });
  assert.equal(state.phase, "gameOver");
  assert.equal(state.winReason, "target");
  assert.equal(state.winnerId, "2");
  assert.equal(state.players[2].balance, 200);
  assert.equal(gameReducer(state, { type: "RESET" }).phase, "setup");
});

test("checks the exact target after a contribution, even before showdown", () => {
  const base = start();
  const state: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      balance: [2100, 500, 250][index],
    })),
  };

  const result = act(state, "match");
  assert.equal(result.phase, "gameOver");
  assert.equal(result.winReason, "target");
  assert.equal(result.winnerId, "0");
  assert.equal(result.players[0].balance, 2000);
  assert.equal(result.pot, 250);
  assertChipsConserved(result);
});

test("flows from starter -> next players -> big -> small on 5-player tables", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["P1", "P2", "P3", "P4", "P5"],
    startingAmount: 1000,
  });

  // Default for 5 players: Starter=P1(0), Next=P2(1), P3(2), Big=P4(3), Small=P5(4)
  assert.equal(state.startIndex, 0);
  assert.equal(state.bigIndex, 3);
  assert.equal(state.smallIndex, 4);
  assert.deepEqual(state.turnOrder, [0, 1, 2, 3, 4]);
  assert.equal(state.players[3].roundBet, 100);
  assert.equal(state.players[4].roundBet, 50);

  const visited: string[] = [];
  for (let step = 0; step < 5; step++) {
    visited.push(state.players[Number(state.currentTurnId)].name);
    state = act(state, "match");
  }
  assert.deepEqual(visited, ["P1", "P2", "P3", "P4", "P5"]);
  assert.equal(state.roundIndex, 1);
  assert.equal(state.currentTurnId, "0");
  assertChipsConserved(state);
});

test("supports custom start, big, and small player selection and orders flow starter -> others -> big -> small", () => {
  let state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan", "Eli"],
    startingAmount: 1000,
    startIndex: 2, // Cleo
    bigIndex: 0,   // Ava
    smallIndex: 1, // Beau
  });

  // Starter=Cleo(2) -> Next=Dan(3) -> Next=Eli(4) -> Big=Ava(0) -> Small=Beau(1)
  assert.deepEqual(state.turnOrder, [2, 3, 4, 0, 1]);
  assert.equal(state.players[0].roundBet, 100);
  assert.equal(state.players[1].roundBet, 50);

  const turnSequence: string[] = [];
  for (let step = 0; step < 5; step++) {
    turnSequence.push(state.players[Number(state.currentTurnId)].name);
    state = act(state, "match");
  }
  assert.deepEqual(turnSequence, ["Cleo", "Dan", "Eli", "Ava", "Beau"]);
  assert.equal(state.roundIndex, 1);

  // Also test SET_ROLES at the start of a hand
  const fresh = gameReducer(INITIAL_GAME, {
    type: "START",
    names: ["Ava", "Beau", "Cleo", "Dan"],
    startingAmount: 1000,
  });
  const reassigned = gameReducer(fresh, {
    type: "SET_ROLES",
    startIndex: 1, // Beau
    bigIndex: 0,   // Ava
    smallIndex: 2, // Cleo
  });
  assert.deepEqual(reassigned.turnOrder, [1, 3, 0, 2]);
  assert.equal(reassigned.currentTurnId, "1");
  assert.equal(reassigned.players[0].roundBet, 100);
  assert.equal(reassigned.players[2].roundBet, 50);
  assertChipsConserved(reassigned);
});

test("records snapshots and allows rolling back and editing player responses during a hand", () => {
  let state = start();

  // Ava (0) matches 100
  state = act(state, "match");
  assert.equal(state.handSnapshots.length, 1);
  assert.equal(state.handSnapshots[0].actorName, "Ava");
  assert.equal(state.handSnapshots[0].summary, "Matched 100");

  // Big: Beau (1) checks/matches
  state = act(state, "match");
  assert.equal(state.handSnapshots.length, 2);

  // Small: Cleo (2) raises to 250
  state = act(state, "raise", 250);
  assert.equal(state.handSnapshots.length, 3);
  assert.equal(state.highestBet, 250);
  assert.equal(state.pot, 450);

  // Now Ava (0) decides: "Wait, Beau actually wanted to fold, or Ava wants to edit Cleo's raise!"
  // Let's test ROLLBACK_TO_SNAPSHOT: Rollback to Cleo's raise snapshot
  const cleoSnap = state.handSnapshots[2];
  let rewound = gameReducer(state, {
    type: "ROLLBACK_TO_SNAPSHOT",
    snapshotId: cleoSnap.snapshotId,
  });

  // State should be exactly right before Cleo raised!
  assert.equal(rewound.currentTurnId, "2"); // Cleo is up
  assert.equal(rewound.highestBet, 100);
  assert.equal(rewound.pot, 250);
  assert.equal(rewound.players[2].roundBet, 50);
  assert.equal(rewound.players[2].balance, 950);
  assert.equal(rewound.handSnapshots.length, 2);

  // Now Cleo can fold instead!
  // Since Ava and Beau already matched 100, Cleo folding completes Pre-flop and advances to Flop!
  rewound = act(rewound, "fold");
  assert.equal(rewound.players[2].folded, true);
  assert.equal(rewound.roundIndex, 1); // Flop
  assert.equal(rewound.highestBet, 0);

  // Test EDIT_ACTION directly: Change Ava's first match (snapshot 0) to a raise to 200
  const avaSnap = state.handSnapshots[0];
  const edited = gameReducer(state, {
    type: "EDIT_ACTION",
    snapshotId: avaSnap.snapshotId,
    kind: "raise",
    amount: 200,
  });
  assert.equal(edited.highestBet, 200);
  assert.equal(edited.players[0].roundBet, 200);
  assert.equal(edited.players[0].balance, 800);
  assert.equal(edited.pot, 350); // 200 (Ava) + 100 (Beau big) + 50 (Cleo small)
  assert.equal(edited.handSnapshots.length, 1);
  assert.equal(edited.handSnapshots[0].summary, "Raised to 200");

  // Test UNDO_LAST_ACTION:
  const undone = gameReducer(edited, { type: "UNDO_LAST_ACTION" });
  assert.equal(undone.handSnapshots.length, 0);
  assert.equal(undone.currentTurnId, "0");
  assert.equal(undone.highestBet, 100);
  assert.equal(undone.players[0].balance, 1000);
  assertChipsConserved(undone);
});

test("undoes hand finish if a fold was accidental via UNDO_HAND_RESULT", () => {
  let state = start();
  // Ava folds, Beau matches
  state = act(state, "fold");
  state = act(state, "match");
  // Cleo folds by mistake! Hand finishes and Beau wins.
  state = act(state, "fold");
  assert.equal(state.handNumber, 2);
  assert.equal(state.history[0].winnerName, "Beau");

  // Undo the accidental result!
  const restored = gameReducer(state, { type: "UNDO_HAND_RESULT" });
  assert.equal(restored.handNumber, 1);
  assert.equal(restored.phase, "playing");
  assert.equal(restored.pot, 150);

  // And now un-fold Cleo via undo last action
  const unFolded = gameReducer(restored, { type: "UNDO_LAST_ACTION" });
  assert.equal(unFolded.players[2].folded, false);
  assert.equal(unFolded.currentTurnId, "2");
  assertChipsConserved(unFolded);
});

test("supports starting after players are reordered with custom roles", () => {
  // Reordered list of players: Charlie (0), Alice (1), David (2), Bob (3)
  const reorderedNames = ["Charlie", "Alice", "David", "Bob"];
  // We want Start: Alice (1), Big: David (2), Small: Bob (3)
  const state = gameReducer(INITIAL_GAME, {
    type: "START",
    names: reorderedNames,
    startingAmount: 1000,
    startIndex: 1, // Alice
    bigIndex: 2,   // David
    smallIndex: 3, // Bob
  });

  // Flow should be: Starter (Alice: 1) -> Next (Charlie: 0) -> Big (David: 2) -> Small (Bob: 3)
  assert.deepEqual(state.turnOrder, [1, 0, 2, 3]);
  assert.equal(state.currentTurnId, "1"); // Alice acts first
  assert.equal(state.players[2].roundBet, 100); // David posted Big
  assert.equal(state.players[3].roundBet, 50);  // Bob posted Small
  assertChipsConserved(state);
});

test("ignores stale turns and duplicate player names", () => {
  const state = start();
  assert.strictEqual(
    gameReducer(state, { type: "ACT", kind: "fold", playerId: "1", handNumber: 1, roundIndex: 0 }),
    state,
  );
  assert.strictEqual(
    gameReducer(INITIAL_GAME, { type: "START", names: ["Ava", "ava", "Cleo"], startingAmount: 1000 }),
    INITIAL_GAME,
  );
});