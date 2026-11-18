import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { render, screen, fireEvent, cleanup, waitFor } = await import("@testing-library/react");
const { default: App } = await import("../src/App");

afterEach(() => {
  cleanup();
  dom.window.localStorage.clear();
});

function savedGame() {
  const saved = dom.window.localStorage.getItem("stack-poker-ledger-v1");
  assert.ok(saved);
  return JSON.parse(saved);
}

function addPlayers(names: string[]) {
  const input = screen.getByPlaceholderText("Enter a player's name");
  for (const name of names) {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Start the game" }));
}

function clickSeat(name: string) {
  const seat = [...dom.window.document.querySelectorAll<HTMLButtonElement>(".player-seat")].find(
    (button) => button.querySelector(".seat-identity strong")?.textContent === name,
  );
  assert.ok(seat);
  fireEvent.click(seat);
}

function setRemaining(name: string, amount: string) {
  const input = screen.getByRole("spinbutton", { name: `Set ${name}'s remaining chips` });
  fireEvent.change(input, { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: /Save stack/i }));
}

test("setup and role editing let Start overlap either blind without merging the blinds", () => {
  render(<App />);
  const input = screen.getByPlaceholderText("Enter a player's name");
  for (const name of ["Ava", "Beau", "Cleo", "Dan"]) {
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));
  }

  const startSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "Start player" });
  const bigSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "BIG player" });
  const smallSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "SMALL player" });
  fireEvent.change(startSelect, { target: { value: "2" } });
  assert.equal(startSelect.value, "2");
  assert.equal(bigSelect.value, "2");
  assert.equal(smallSelect.value, "3");

  fireEvent.change(smallSelect, { target: { value: "2" } });
  assert.equal(startSelect.value, "2");
  assert.equal(bigSelect.value, "3");
  assert.equal(smallSelect.value, "2");

  fireEvent.click(screen.getByRole("button", { name: "Start the game" }));
  assert.equal(savedGame().startIndex, 2);
  assert.equal(savedGame().bigIndex, 3);
  assert.equal(savedGame().smallIndex, 2);
  assert.equal(savedGame().players[3].roundBet, 100);
  assert.equal(savedGame().players[2].roundBet, 50);
  assert.equal(savedGame().pot, 150);
  assert.equal(savedGame().currentTurnId, "2");

  fireEvent.click(screen.getByRole("button", { name: /Roles/i }));
  fireEvent.change(screen.getByRole("combobox", { name: "Start player" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /Apply roles/i }));
  assert.equal(savedGame().startIndex, 3);
  assert.equal(savedGame().bigIndex, 3);
  assert.equal(savedGame().smallIndex, 2);
  assert.equal(savedGame().currentTurnId, "3");
});

test("can correct a stack from a player card and doubles the big blind after elimination", async () => {
  render(<App />);
  addPlayers(["Ava", "Beau", "Cleo", "Dan", "Eli"]);
  assert.equal(savedGame().bigBlind, 100);

  clickSeat("Eli");
  assert.ok(screen.getByText("CORRECT REMAINING STACK"));
  setRemaining("Eli", "0");

  await waitFor(() => assert.equal(savedGame().players[4].balance, 0));
  assert.equal(savedGame().bigBlind, 100);
  assert.equal(savedGame().pot, 150);
  assert.equal(savedGame().players[4].sittingOut, false);

  // A correction survives a refresh and can still be edited afterward.
  cleanup();
  render(<App />);
  assert.equal(savedGame().players[4].balance, 0);

  fireEvent.click(screen.getByRole("button", { name: /End match \/ showdown/i }));
  fireEvent.click(screen.getByRole("radio", { name: /Ava/ }));
  fireEvent.click(screen.getByRole("button", { name: /Award pot/i }));
  await waitFor(() => assert.equal(savedGame().bigBlind, 200));
  assert.equal(savedGame().smallBlind, 100);
  assert.equal(savedGame().players[4].sittingOut, true);
  assert.ok(screen.getByTitle("Big blind doubles for each player out at the start of this hand"));

  clickSeat("Eli");
  setRemaining("Eli", "200");
  await waitFor(() => assert.equal(savedGame().players[4].balance, 200));
  assert.equal(savedGame().players[4].sittingOut, true);

  fireEvent.click(screen.getByRole("button", { name: /End match \/ showdown/i }));
  fireEvent.click(screen.getByRole("radio", { name: /Beau/ }));
  fireEvent.click(screen.getByRole("button", { name: /Award pot/i }));
  await waitFor(() => assert.equal(savedGame().handNumber, 3));
  assert.equal(savedGame().bigBlind, 100);
  assert.equal(savedGame().players[4].sittingOut, false);
});

test("manual stack correction that triggers game over can be undone", async () => {
  render(<App />);
  addPlayers(["Ava", "Beau", "Cleo"]);
  clickSeat("Ava");
  setRemaining("Ava", "2000");

  await waitFor(() => assert.equal(savedGame().phase, "gameOver"));
  assert.ok(screen.getByRole("button", { name: /Undo last stack correction/i }));
  cleanup();
  render(<App />);
  assert.equal(savedGame().phase, "gameOver");
  fireEvent.click(screen.getByRole("button", { name: /Undo last stack correction/i }));
  await waitFor(() => assert.equal(savedGame().phase, "playing"));
  assert.equal(savedGame().players[0].balance, 1000);
  assert.equal(savedGame().pot, 150);
});

test("zeroing the active player's stack advances play and can be rewound from their card", async () => {
  render(<App />);
  addPlayers(["Ava", "Beau", "Cleo"]);
  clickSeat("Ava");

  const input = screen.getByRole("spinbutton", { name: "Set Ava's remaining chips" });
  fireEvent.change(input, { target: { value: "-1" } });
  assert.equal(screen.getByRole("button", { name: /Save stack/i }).hasAttribute("disabled"), true);

  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: /Save stack/i }));
  await waitFor(() => assert.equal(savedGame().currentTurnId, "1"));
  assert.equal(savedGame().players[0].sittingOut, true);

  clickSeat("Ava");
  assert.ok(screen.getByText("Stack corrected"));
  fireEvent.click(screen.getByRole("button", { name: /Rewind to before correction/i }));
  await waitFor(() => assert.equal(savedGame().currentTurnId, "0"));
  assert.equal(savedGame().players[0].balance, 1000);
  assert.equal(savedGame().netAdjustments, 0);
  assert.equal(savedGame().balanceAdjustments.length, 0);
});

test("showdown skips an eliminated next Big and offers only funded players for blinds", () => {
  render(<App />);
  addPlayers(["Ava", "Beau", "Cleo", "Dan", "Eli"]);
  clickSeat("Eli");
  setRemaining("Eli", "0");

  fireEvent.click(screen.getByRole("button", { name: /End match \/ showdown/i }));
  fireEvent.click(screen.getByRole("radio", { name: /Ava/ }));

  const bigSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "BIG player" });
  const smallSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "SMALL player" });
  assert.equal(bigSelect.value, "0");
  assert.equal(smallSelect.value, "1");
  assert.equal([...bigSelect.options].some((option) => option.text === "Eli"), false);

  fireEvent.click(screen.getByRole("button", { name: /Award pot/i }));
  assert.equal(savedGame().bigIndex, 0);
  assert.equal(savedGame().smallIndex, 1);
  assert.equal(savedGame().startIndex, 1);
  assert.equal(savedGame().players[0].roundBet, 200);
  assert.equal(savedGame().players[1].roundBet, 100);
});

test("heads-up showdown allows Start/Small, swaps blinds, and survives reload", () => {
  render(<App />);
  addPlayers(["Ava", "Beau", "Cleo", "Dan"]);
  clickSeat("Ava");
  setRemaining("Ava", "0");
  clickSeat("Beau");
  setRemaining("Beau", "0");

  fireEvent.click(screen.getByRole("button", { name: /End match \/ showdown/i }));
  fireEvent.click(screen.getByRole("radio", { name: /Cleo/ }));

  const startSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "Start player" });
  const bigSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "BIG player" });
  const smallSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "SMALL player" });
  assert.equal(startSelect.disabled, false);
  assert.equal(startSelect.value, "2");
  assert.equal(bigSelect.value, "3");
  assert.equal(smallSelect.value, "2");
  assert.equal([...bigSelect.options].length, 2);
  assert.ok(screen.getByText("Two players left: both post blinds. Start can be Big or Small."));

  fireEvent.click(screen.getByRole("button", { name: /Award pot/i }));

  assert.equal(savedGame().startIndex, 2);
  assert.equal(savedGame().bigIndex, 3);
  assert.equal(savedGame().smallIndex, 2);
  assert.equal(savedGame().bigBlind, 400);
  assert.equal(savedGame().smallBlind, 200);
  assert.equal(savedGame().players[3].roundBet, 400);
  assert.equal(savedGame().players[2].roundBet, 200);
  assert.equal(savedGame().pot, 600);
  assert.equal(savedGame().currentTurnId, "2");
  assert.equal(dom.window.document.querySelectorAll(".table-flow-node-btn").length, 2);
  assert.match(dom.window.document.querySelector(".action-kicker")?.textContent ?? "", /TURN 01 \/ 02/);

  clickSeat("Cleo");
  assert.ok(screen.getByText("START"));
  assert.ok(screen.getByText("SMALL"));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  cleanup();
  render(<App />);
  assert.equal(savedGame().bigIndex, 3);
  assert.equal(savedGame().startIndex, 2);
  assert.equal(savedGame().pot, 600);
  assert.equal(savedGame().currentTurnId, "2");
  assert.equal(dom.window.document.querySelectorAll(".table-flow-node-btn").length, 2);

  fireEvent.click(screen.getByRole("button", { name: /Roles/i }));
  const roleBigSelect = screen.getByRole<HTMLSelectElement>("combobox", { name: "BIG player" });
  fireEvent.change(roleBigSelect, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: /Apply roles/i }));
  assert.equal(savedGame().bigIndex, 2);
  assert.equal(savedGame().smallIndex, 3);
  assert.equal(savedGame().startIndex, 2);
  assert.equal(savedGame().players[2].roundBet, 400);
  assert.equal(savedGame().players[3].roundBet, 200);
  assert.equal(savedGame().currentTurnId, "2");

  fireEvent.click(screen.getByRole("button", { name: "Check" }));
  assert.equal(savedGame().currentTurnId, "3");
  fireEvent.click(screen.getByRole("button", { name: "Match 200" }));
  assert.equal(savedGame().roundIndex, 1);
  assert.equal(savedGame().currentTurnId, "2");
});