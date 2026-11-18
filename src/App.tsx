import { useEffect, useReducer, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
  Undo2,
  X,
} from "lucide-react";
import {
  INITIAL_GAME,
  ROUND_NAMES,
  buildTurnOrder,
  defaultRoles,
  gameReducer,
  getSeatRoles,
  isInHand,
  isValidRoleSelection,
  nextHandRoles,
  type GameAction,
  type GamePhase,
  type GameState,
  type HandStepSnapshot,
  type Player,
  type RoleSelection,
  type SeatRole,
} from "./game";

const STORAGE_KEY = "stack-poker-ledger-v1";
const numberFormat = new Intl.NumberFormat("en-US");

function formatAmount(amount: number): string {
  return numberFormat.format(amount);
}

function handNumber(number: number): string {
  return String(number).padStart(2, "0");
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function shortRoles(roles: SeatRole[]): string {
  return roles.map((role) => role === "starting" ? "START" : role === "big" ? "BIG" : "SMALL").join(" / ");
}

function updateRoleSelection(
  current: RoleSelection,
  role: keyof RoleSelection,
  nextIndex: number,
): RoleSelection {
  const prevIndex = current[role];
  if (prevIndex === nextIndex) return current;

  if (role === "startIndex") return { ...current, startIndex: nextIndex };
  if (role === "bigIndex") {
    return {
      ...current,
      bigIndex: nextIndex,
      smallIndex: current.smallIndex === nextIndex ? prevIndex : current.smallIndex,
    };
  }
  return {
    ...current,
    smallIndex: nextIndex,
    bigIndex: current.bigIndex === nextIndex ? prevIndex : current.bigIndex,
  };
}

function loadSavedGame(): GameState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return INITIAL_GAME;

    const parsed = JSON.parse(saved) as Partial<GameState>;
    if (
      (parsed.phase !== "playing" && parsed.phase !== "gameOver") ||
      !Array.isArray(parsed.players) ||
      parsed.players.length < 3 ||
      !Array.isArray(parsed.history) ||
      !Array.isArray(parsed.actedIds) ||
      !Number.isSafeInteger(parsed.startingAmount) ||
      !Number.isSafeInteger(parsed.handNumber) ||
      !Number.isSafeInteger(parsed.startIndex) ||
      !Number.isSafeInteger(parsed.roundIndex) ||
      parsed.startIndex! < 0 ||
      parsed.startIndex! >= parsed.players.length ||
      parsed.roundIndex! < 0 ||
      parsed.roundIndex! >= ROUND_NAMES.length ||
      !Number.isSafeInteger(parsed.pot) ||
      parsed.players.some((player) => !player.id || !player.name || !Number.isSafeInteger(player.balance))
    ) {
      return INITIAL_GAME;
    }

    const count = parsed.players.length;
    const fallbackBig = (parsed.startIndex! + count - 2) % count;
    const fallbackSmall = (parsed.startIndex! + count - 1) % count;
    const roles: RoleSelection = {
      startIndex: parsed.startIndex!,
      bigIndex: Number.isInteger(parsed.bigIndex) ? parsed.bigIndex! : fallbackBig,
      smallIndex: Number.isInteger(parsed.smallIndex) ? parsed.smallIndex! : fallbackSmall,
    };
    const validRoles = isValidRoleSelection(count, roles)
      ? roles
      : { startIndex: parsed.startIndex!, bigIndex: fallbackBig, smallIndex: fallbackSmall };

    const expectedOrder = buildTurnOrder(
      count, validRoles.startIndex, validRoles.bigIndex, validRoles.smallIndex,
    );
    const turnOrder =
      Array.isArray(parsed.turnOrder) &&
      parsed.turnOrder.length === count &&
      parsed.turnOrder.every((index, position) => index === expectedOrder[position])
        ? parsed.turnOrder
        : expectedOrder;

    return {
      ...(parsed as GameState),
      bigIndex: validRoles.bigIndex,
      smallIndex: validRoles.smallIndex,
      turnOrder,
      handSnapshots: Array.isArray(parsed.handSnapshots) ? parsed.handSnapshots : [],
      balanceAdjustments: Array.isArray(parsed.balanceAdjustments) ? parsed.balanceAdjustments : [],
      netAdjustments: Number.isSafeInteger(parsed.netAdjustments) ? parsed.netAdjustments! : 0,
      previousHandState: parsed.previousHandState
        ? {
            ...parsed.previousHandState,
            handSnapshots: Array.isArray(parsed.previousHandState.handSnapshots)
              ? parsed.previousHandState.handSnapshots
              : [],
            balanceAdjustments: Array.isArray(parsed.previousHandState.balanceAdjustments)
              ? parsed.previousHandState.balanceAdjustments
              : [],
            netAdjustments: Number.isSafeInteger(parsed.previousHandState.netAdjustments)
              ? parsed.previousHandState.netAdjustments
              : 0,
            previousHandState: null,
          }
        : null,
    };
  } catch {
    return INITIAL_GAME;
  }
}

function Brand() {
  return (
    <div className="brand-lockup" aria-label="Stack poker ledger">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-word">STACK<span>.</span></span>
    </div>
  );
}

function Header({ phase, onReset }: { phase: GamePhase; onReset: () => void }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <div className="header-right">
          {phase === "playing" ? (
            <>
              <span className="session-indicator"><span className="live-light" /> SESSION LIVE</span>
              <button className="header-reset" type="button" onClick={onReset}>
                <RotateCcw size={15} strokeWidth={1.9} /> New game
              </button>
            </>
          ) : (
            <span className="header-caption">THE POKER LEDGER</span>
          )}
        </div>
      </div>
    </header>
  );
}

function RoleSelectorGroup({
  names,
  roles,
  onChange,
  idPrefix,
  eligibleIndices,
}: {
  names: string[];
  roles: RoleSelection;
  onChange: (next: RoleSelection) => void;
  idPrefix: string;
  eligibleIndices?: number[];
}) {
  const available = eligibleIndices ?? names.map((_, index) => index);
  const disabled = names.length < 3 || available.length < 2;
  const headsUp = !disabled && available.length === 2;
  const flowOrder = disabled
    ? []
    : buildTurnOrder(names.length, roles.startIndex, roles.bigIndex, roles.smallIndex)
        .filter((index) => available.includes(index));

  function selectRole(role: keyof RoleSelection, nextIndex: number) {
    onChange(updateRoleSelection(roles, role, nextIndex));
  }

  return (
    <div className="role-selector-block">
      <div className="role-selector-grid">
        <div className="role-select-field">
          <label htmlFor={`${idPrefix}-start-player`}>START PLAYER</label>
          <select
            id={`${idPrefix}-start-player`}
            aria-label="Start player"
            disabled={disabled}
            value={disabled ? "" : roles.startIndex}
            onChange={(event) => selectRole("startIndex", Number(event.target.value))}
          >
            {disabled ? (
              <option value="">Add 3+ players</option>
            ) : (
              available.map((index) => (
                <option value={index} key={`${names[index]}-${index}`}>
                  {names[index]}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="role-select-field">
          <label htmlFor={`${idPrefix}-big-player`}>BIG PLAYER</label>
          <select
            id={`${idPrefix}-big-player`}
            aria-label="BIG player"
            disabled={disabled}
            value={disabled ? "" : roles.bigIndex}
            onChange={(event) => selectRole("bigIndex", Number(event.target.value))}
          >
            {disabled ? (
              <option value="">Add 3+ players</option>
            ) : (
              available.map((index) => (
                <option value={index} key={`${names[index]}-${index}`}>
                  {names[index]}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="role-select-field">
          <label htmlFor={`${idPrefix}-small-player`}>SMALL PLAYER</label>
          <select
            id={`${idPrefix}-small-player`}
            aria-label="SMALL player"
            disabled={disabled}
            value={disabled ? "" : roles.smallIndex}
            onChange={(event) => selectRole("smallIndex", Number(event.target.value))}
          >
            {disabled ? (
              <option value="">Add 3+ players</option>
            ) : (
              available.map((index) => (
                <option value={index} key={`${names[index]}-${index}`}>
                  {names[index]}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {headsUp && (
        <p className="role-heads-up-note">Two players left: both post blinds. Start can be Big or Small.</p>
      )}

      {!disabled && (
        <div className="flow-preview" aria-label="Turn order flow">
          <span className="flow-preview-label">FLOW</span>
          <div className="flow-preview-steps">
            {flowOrder.map((playerIndex, position) => {
              const seatRoles = getSeatRoles(playerIndex, roles);
              const role = shortRoles(seatRoles);
              const roleStyle = seatRoles.includes("big") ? "big" : seatRoles.includes("small") ? "small" : "start";
              return (
                <span className="flow-preview-item" key={playerIndex}>
                  {position > 0 && <span className="flow-arrow" aria-hidden="true">→</span>}
                  <span className={`flow-chip ${role ? `flow-chip-${roleStyle}` : ""}`}>
                    <b>{names[playerIndex]}</b>
                    {role && <small>{role}</small>}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SetupPreview({ names, roles }: { names: string[]; roles: RoleSelection }) {
  const orderedNames =
    names.length >= 3
      ? buildTurnOrder(names.length, roles.startIndex, roles.bigIndex, roles.smallIndex)
          .slice(0, 8)
          .map((playerIndex) => ({
            name: names[playerIndex],
            role: shortRoles(getSeatRoles(playerIndex, roles)),
          }))
      : (names.length > 0 ? names : ["", "", ""]).slice(0, 8).map((name) => ({ name, role: null }));

  return (
    <div className="setup-preview" aria-hidden="true">
      <div className="preview-rail">
        <div className="preview-rail-inner" />
        <div className="preview-center">
          <span>THE TABLE</span>
          <strong>IS YOURS.</strong>
        </div>
      </div>
      {orderedNames.map((seat, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / orderedNames.length;
        const style = {
          left: `${50 + Math.cos(angle) * 38}%`,
          top: `${48 + Math.sin(angle) * 39}%`,
        } as CSSProperties;

        return (
          <span className={`preview-seat ${seat.name ? "preview-seat-filled" : ""}`} style={style} key={index}>
            {seat.name ? initials(seat.name) : <Plus size={15} strokeWidth={1.5} />}
            {seat.role && <small className="preview-seat-tag">{seat.role}</small>}
          </span>
        );
      })}
      <div className="preview-footer">
        <span>{roles.startIndex === roles.bigIndex || roles.startIndex === roles.smallIndex
          ? "FLOW: START FIRST / ONE TURN EACH"
          : "FLOW: STARTER → NEXT → BIG → SMALL"}</span>
        <span>{String(names.length).padStart(2, "0")} PLAYERS ADDED</span>
      </div>
    </div>
  );
}

function SetupScreen({
  onStart,
}: {
  onStart: (names: string[], amount: number, roles: RoleSelection) => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [startingInput, setStartingInput] = useState("1000");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [customRoleNames, setCustomRoleNames] = useState<{
    startName: string;
    bigName: string;
    smallName: string;
  } | null>(null);
  const [error, setError] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const startingAmount = Number(startingInput);
  const validAmount =
    /^\d+$/.test(startingInput) &&
    Number.isSafeInteger(startingAmount) &&
    startingAmount >= 1 &&
    startingAmount <= 1_000_000_000;

  const resolvedRoles: RoleSelection = (() => {
    if (names.length < 3) return defaultRoles(names.length);
    if (customRoleNames) {
      const startIndex = names.indexOf(customRoleNames.startName);
      const bigIndex = names.indexOf(customRoleNames.bigName);
      const smallIndex = names.indexOf(customRoleNames.smallName);
      const candidate = { startIndex, bigIndex, smallIndex };
      if (isValidRoleSelection(names.length, candidate)) {
        return candidate;
      }
    }
    return defaultRoles(names.length);
  })();

  function setRolesFromIndices(next: RoleSelection) {
    if (names.length < 3) return;
    setCustomRoleNames({
      startName: names[next.startIndex],
      bigName: names[next.bigIndex],
      smallName: names[next.smallIndex],
    });
    setError("");
  }

  function movePlayer(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= names.length || fromIndex === toIndex) return;

    if (!customRoleNames && names.length >= 3) {
      setCustomRoleNames({
        startName: names[resolvedRoles.startIndex],
        bigName: names[resolvedRoles.bigIndex],
        smallName: names[resolvedRoles.smallIndex],
      });
    }

    setNames((current) => {
      const copy = [...current];
      const [item] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, item);
      return copy;
    });
    setError("");
  }

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError("Enter a name to add a player.");
      addInputRef.current?.focus();
      return;
    }
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setError("That player is already at the table.");
      addInputRef.current?.focus();
      return;
    }

    setNames((current) => [...current, name]);
    setNewName("");
    setError("");
    addInputRef.current?.focus();
  }

  function startGame() {
    if (names.length < 3) {
      setError("Add at least three players to start.");
      return;
    }
    if (!validAmount || !Number.isSafeInteger(startingAmount * names.length)) {
      setError("Use a positive whole number for the starting stack.");
      return;
    }
    if (!isValidRoleSelection(names.length, resolvedRoles)) {
      setError("Choose different players for Big and Small. Start may hold either blind.");
      return;
    }
    onStart(names, startingAmount, resolvedRoles);
  }

  return (
    <main className="setup-main">
      <section className="setup-intro">
        <div className="intro-copy">
          <div className="eyebrow intro-eyebrow"><span className="eyebrow-line" /> THE GAME, WITHOUT THE GUESSWORK</div>
          <h1 className="setup-brand-title">STACK<span>.</span></h1>
          <p className="setup-tagline">Every chip.<br />Accounted for.</p>
          <p className="setup-description">
            A simple, precise way to manage the table. You play the game. We keep the count.
          </p>
        </div>
        <SetupPreview names={names} roles={resolvedRoles} />
      </section>

      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="panel-kicker"><span>01 / TABLE SETUP</span><span className="panel-kicker-rule" /></div>
        <h2 id="setup-title">Set your table.</h2>
        <p className="panel-description">Add players, set their order and assign roles. The Starter can also post Big or Small.</p>

        <label className="field-label" htmlFor="starting-stack">STARTING STACK <span>PER PLAYER</span></label>
        <div className={`starting-field ${!validAmount ? "field-invalid" : ""}`}>
          <input
            id="starting-stack"
            type="number"
            min="1"
            max="1000000000"
            step="1"
            inputMode="numeric"
            value={startingInput}
            onChange={(event) => { setStartingInput(event.target.value); setError(""); }}
            aria-invalid={!validAmount}
          />
          <span>CHIPS</span>
        </div>
        {!validAmount && <p className="field-help error-text">Enter a whole number between 1 and 1,000,000,000.</p>}

        <div className="player-list-heading">
          <label className="field-label" htmlFor="new-player">PLAYERS &amp; SEATING ORDER <span className="player-count">{names.length}</span></label>
          <span className="minimum-label">{names.length >= 2 ? "USE ↑ ↓ OR DRAG TO REORDER" : "MINIMUM 03"}</span>
        </div>
        {names.length > 0 && (
          <div className="setup-player-list" aria-label="Players at the table in seating order">
            {names.map((name, index) => {
              const isStart = names.length >= 3 && resolvedRoles.startIndex === index;
              const isBig = names.length >= 3 && resolvedRoles.bigIndex === index;
              const isSmall = names.length >= 3 && resolvedRoles.smallIndex === index;

              return (
                <div
                  className={`setup-player ${draggedIndex === index ? "setup-player-dragging" : ""}`}
                  key={`${name}-${index}`}
                  draggable={true}
                  onDragStart={(event) => {
                    setDraggedIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedIndex !== null && draggedIndex !== index) {
                      movePlayer(draggedIndex, index);
                    }
                    setDraggedIndex(null);
                  }}
                  onDragEnd={() => setDraggedIndex(null)}
                >
                  <span className="setup-drag-handle" title="Drag to reorder seat" aria-hidden="true">
                    <GripVertical size={14} />
                  </span>
                  <span className="setup-player-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="setup-player-avatar">{initials(name)}</span>
                  <span className="setup-player-name">{name}</span>

                  <div className="setup-reorder-buttons" aria-label={`Change ${name}'s seating position`}>
                    <button
                      type="button"
                      className="setup-reorder-btn"
                      disabled={index === 0}
                      onClick={() => movePlayer(index, index - 1)}
                      title="Move up in seating order"
                      aria-label={`Move ${name} up`}
                    >
                      <ChevronUp size={14} strokeWidth={2.4} />
                    </button>
                    <button
                      type="button"
                      className="setup-reorder-btn"
                      disabled={index === names.length - 1}
                      onClick={() => movePlayer(index, index + 1)}
                      title="Move down in seating order"
                      aria-label={`Move ${name} down`}
                    >
                      <ChevronDown size={14} strokeWidth={2.4} />
                    </button>
                  </div>

                  {names.length >= 3 && (
                    <div className="setup-role-pills" role="group" aria-label={`Assign role for ${name}`}>
                      <button
                        type="button"
                        className={`setup-role-pill ${isStart ? "pill-active-start" : ""}`}
                        onClick={() =>
                          setRolesFromIndices(updateRoleSelection(resolvedRoles, "startIndex", index))
                        }
                        aria-pressed={isStart}
                      >
                        START
                      </button>
                      <button
                        type="button"
                        className={`setup-role-pill ${isBig ? "pill-active-big" : ""}`}
                        onClick={() =>
                          setRolesFromIndices(updateRoleSelection(resolvedRoles, "bigIndex", index))
                        }
                        aria-pressed={isBig}
                      >
                        BIG
                      </button>
                      <button
                        type="button"
                        className={`setup-role-pill ${isSmall ? "pill-active-small" : ""}`}
                        onClick={() =>
                          setRolesFromIndices(updateRoleSelection(resolvedRoles, "smallIndex", index))
                        }
                        aria-pressed={isSmall}
                      >
                        SMALL
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="remove-player"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      setNames((current) => current.filter((_, playerIndex) => playerIndex !== index));
                      setError("");
                    }}
                  >
                    <X size={16} strokeWidth={1.8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <form className="add-player-form" onSubmit={addPlayer}>
          <div className="add-player-input">
            <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
            <input
              ref={addInputRef}
              id="new-player"
              type="text"
              maxLength={22}
              autoComplete="off"
              placeholder="Enter a player's name"
              value={newName}
              onChange={(event) => { setNewName(event.target.value); setError(""); }}
            />
          </div>
          <button className="add-player-button" type="submit" aria-label="Add player">
            <ArrowRight size={18} strokeWidth={2} />
          </button>
        </form>

        <div className="role-setup-section">
          <div className="player-list-heading">
            <span className="field-label">ROLES &amp; FLOW</span>
            <span className="minimum-label">START CAN ALSO POST A BLIND</span>
          </div>
          <RoleSelectorGroup
            names={names}
            roles={resolvedRoles}
            onChange={setRolesFromIndices}
            idPrefix="setup"
          />
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="start-button" type="button" disabled={names.length < 3 || !validAmount} onClick={startGame}>
          <span>Start the game</span><ArrowUpRight size={20} strokeWidth={2} />
        </button>
        <p className="setup-footnote">
          {names.length < 3
            ? `Add ${3 - names.length} more ${3 - names.length === 1 ? "player" : "players"} to select Start, Big, and Small.`
            : "Use ↑ and ↓ arrows to set table order. Blinds post automatically when you start."}
        </p>
      </section>
    </main>
  );
}

function PlayerSeat({
  player,
  playerIndex,
  flowPosition,
  state,
  style,
  onSelectPlayer,
}: {
  player: Player;
  playerIndex: number;
  flowPosition: number;
  state: GameState;
  style: CSSProperties;
  onSelectPlayer: () => void;
}) {
  const roles = getSeatRoles(playerIndex, state);
  const role: SeatRole | null = roles[0] ?? null;
  const active = state.currentTurnId === player.id;
  const status = player.sittingOut
    ? player.balance === 0 ? "OUT OF CHIPS" : "NEXT HAND"
    : player.folded ? "FOLDED" : player.balance === 0 ? "ALL IN" : null;

  const playerSnapshots = (state.handSnapshots || []).filter((s) => s.actorId === player.id);
  const lastAction = playerSnapshots[playerSnapshots.length - 1];

  return (
    <button
      type="button"
      className={`player-seat ${active ? "seat-active" : ""} ${
        player.folded || player.sittingOut ? "seat-muted" : ""
      } player-seat-clickable`}
      style={style}
      onClick={onSelectPlayer}
      title={`Click to edit ${player.name}'s stack or betting response`}
      aria-label={`${player.name}, ${shortRoles(roles) || "player"}, turn ${flowPosition + 1}, ${formatAmount(
        player.balance,
      )} chips remaining, ${formatAmount(player.roundBet)} bet this round${
        status ? `, ${status.toLowerCase()}` : ""
      }${active ? ", active turn" : ""}. Click to edit stack or betting response.`}
    >
      <div className="seat-meta">
        <span className="seat-index">{String(flowPosition + 1).padStart(2, "0")}</span>
        {role && <span className={`seat-role role-${roles.includes("big") ? "big" : role}`}>{shortRoles(roles)}</span>}
        {status && <span className="seat-status">{status}</span>}
      </div>
      <div className="seat-identity">
        <span className="seat-avatar">{initials(player.name)}</span>
        <strong title={player.name}>{player.name}</strong>
        {lastAction && (
          <span className="seat-edit-badge" title={`Latest: ${lastAction.summary}. Click to edit.`}>
            <Pencil size={9} strokeWidth={2.5} />
          </span>
        )}
      </div>
      <div className="seat-balances">
        <span><small>REMAINING</small><b>{formatAmount(player.balance)}</b></span>
        <span><small>ROUND BET</small><b>{formatAmount(player.roundBet)}</b></span>
      </div>
      {lastAction && (
        <div className="seat-last-move" title={`${lastAction.roundName}: ${lastAction.summary}`}>
          <small>{lastAction.roundName.slice(0, 4)}:</small> <span>{lastAction.summary}</span>
        </div>
      )}
    </button>
  );
}

function TableSurface({
  state,
  onOpenRoles,
  onSelectPlayer,
}: {
  state: GameState;
  onOpenRoles: () => void;
  onSelectPlayer: (playerId: string) => void;
}) {
  const gridMode = state.players.length > 8;
  const turnOrder =
    state.turnOrder.length === state.players.length
      ? state.turnOrder
      : buildTurnOrder(state.players.length, state.startIndex, state.bigIndex, state.smallIndex);
  const activeFlow = turnOrder.filter((index) => isInHand(state.players[index]));
  const canEditRoles = state.roundIndex === 0 && state.handSnapshots.length === 0;
  const blindMultiplier = state.bigBlind / 100;
  const overlappingStarter = state.startIndex === state.bigIndex || state.startIndex === state.smallIndex;

  return (
    <section className={`table-surface ${gridMode ? "table-grid-mode" : ""}`} aria-label="Poker table">
      <div className="surface-heading">
        <span>HAND {handNumber(state.handNumber)} <span className="surface-divider">/</span> {ROUND_NAMES[state.roundIndex].toUpperCase()}</span>
        <div className="surface-heading-right">
          <span className="surface-blinds">
            BIG {formatAmount(state.bigBlind)}
            {blindMultiplier > 1 && <span className="blind-multiplier" title="Big blind doubles for each player out at the start of this hand">x{blindMultiplier}</span>}
            <span>/</span> SMALL {formatAmount(state.smallBlind)}
          </span>
          {canEditRoles && (
            <button type="button" className="surface-roles-button" onClick={onOpenRoles}>
              <SlidersHorizontal size={12} strokeWidth={2} /> Roles
            </button>
          )}
        </div>
      </div>

      <div className="table-flow-bar" aria-label="Turn flow, excluding folded and eliminated players">
        <span className="table-flow-title">TURN FLOW</span>
        <div className="table-flow-items">
          {activeFlow.map((playerIndex, pos) => {
            const player = state.players[playerIndex];
            const role = getSeatRoles(playerIndex, state);
            const isCurrent = state.currentTurnId === player.id;
            return (
              <button
                type="button"
                className="table-flow-node-btn"
                key={player.id}
                onClick={() => onSelectPlayer(player.id)}
                title={`Click to edit ${player.name}'s stack or response`}
              >
                {pos > 0 && <span className="table-flow-arrow" aria-hidden="true">→</span>}
                <span
                  className={`table-flow-pill ${isCurrent ? "table-flow-pill-active" : ""} ${
                    player.folded || player.sittingOut ? "table-flow-pill-muted" : ""
                  }`}
                >
                  <b>{player.name}</b>
                  {role.length > 0 && <small>{shortRoles(role)}</small>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="table-stage">
        <div className="table-rail" aria-hidden="true"><div className="table-rail-inner" /></div>
        <div className="pot-display" aria-live="polite" aria-label={`Pot: ${formatAmount(state.pot)} chips`}>
          <span className="pot-overline"><span className="pot-overline-line" /> TOTAL POT <span className="pot-overline-line" /></span>
          <strong key={`${state.handNumber}-${state.pot}`}>{formatAmount(state.pot)}</strong>
          <span className="pot-unit">CHIPS IN POT</span>
        </div>
        <div className="table-seats">
          {turnOrder.map((playerIndex, flowPosition) => {
            const player = state.players[playerIndex];
            const angle = -Math.PI / 2 + (2 * Math.PI * flowPosition) / turnOrder.length;
            const style = {
              "--seat-x": `${50 + Math.cos(angle) * 35.5}%`,
              "--seat-y": `${51 + Math.sin(angle) * 36}%`,
            } as CSSProperties;
            return (
              <PlayerSeat
                key={player.id}
                player={player}
                playerIndex={playerIndex}
                flowPosition={flowPosition}
                state={state}
                style={style}
                onSelectPlayer={() => onSelectPlayer(player.id)}
              />
            );
          })}
        </div>
      </div>
      <div className="surface-footer">
        <span><span className="surface-footer-dot" /> {state.players.filter(isInHand).length} IN THE HAND / SELECT A SEAT TO EDIT</span>
        <span>{blindMultiplier > 1 ? `BIG BLIND x${blindMultiplier} / OUT PLAYERS` : overlappingStarter ? "STARTER FIRST / ONE TURN EACH" : "FLOW: STARTER → NEXT → BIG → SMALL"}</span>
      </div>
    </section>
  );
}

function ActionPanel({
  state,
  onAction,
  onShowdown,
  onUndoLastAction,
}: {
  state: GameState;
  onAction: (kind: "match" | "raise" | "fold", amount?: number) => void;
  onShowdown: () => void;
  onUndoLastAction: () => void;
}) {
  const player = state.players.find((entry) => entry.id === state.currentTurnId);
  const due = player ? Math.max(0, state.highestBet - player.roundBet) : 0;
  const minRaise = state.highestBet + 1;
  const maxRaise = player ? player.roundBet + player.balance : 0;
  const [raiseValue, setRaiseValue] = useState("");

  const lastSnapshot: HandStepSnapshot | undefined =
    state.handSnapshots && state.handSnapshots.length > 0
      ? state.handSnapshots[state.handSnapshots.length - 1]
      : undefined;

  useEffect(() => {
    if (!player || maxRaise < minRaise) {
      setRaiseValue("");
      return;
    }
    setRaiseValue(String(Math.min(maxRaise, Math.max(minRaise, state.highestBet + 100))));
  }, [player?.id, state.handNumber, state.roundIndex, state.highestBet, minRaise, maxRaise]);

  const raiseNumber = Number(raiseValue);
  const validRaise =
    /^\d+$/.test(raiseValue) &&
    Number.isSafeInteger(raiseNumber) &&
    raiseNumber >= minRaise &&
    raiseNumber <= maxRaise;

  if (!player) {
    const isRiver = state.roundIndex === ROUND_NAMES.length - 1;
    return (
      <aside className="action-panel settle-panel" aria-label="Match controls">
        <div className="action-kicker"><span><span className="action-light" /> HAND STATUS</span><span>{handNumber(state.handNumber)}</span></div>
        <div className="settle-content">
          <div className="settle-icon"><Check size={27} strokeWidth={1.8} /></div>
          <p className="settle-eyebrow">{isRiver ? "BETTING COMPLETE" : "ALL PLAYERS ARE ALL IN"}</p>
          <h2>Time to settle.</h2>
          <p>{isRiver ? "The final round is complete." : "There are no more moves to make."} Choose a player still in the hand to take the pot.</p>
          <div className="settle-pot"><span>POT TO AWARD</span><strong>{formatAmount(state.pot)} <small>CHIPS</small></strong></div>
          <button className="primary-action" type="button" onClick={onShowdown}>
            Choose the winner <ArrowUpRight size={20} strokeWidth={2} />
          </button>
          {lastSnapshot && (
            <button
              type="button"
              className="undo-secondary-btn"
              onClick={onUndoLastAction}
              title={`Undo ${lastSnapshot.actorName}'s ${lastSnapshot.summary}`}
            >
              <Undo2 size={15} strokeWidth={2} /> Undo last {lastSnapshot.actionKind === "adjust" ? "correction" : "move"} ({lastSnapshot.actorName}: {lastSnapshot.summary})
            </button>
          )}
        </div>
        <div className="action-bottom-note">Only players who have not folded can win this hand. Click a player card to edit a response or correct their stack.</div>
      </aside>
    );
  }

  const playerIndex = state.players.findIndex((entry) => entry.id === player.id);
  const turnOrder =
    state.turnOrder.length === state.players.length
      ? state.turnOrder
      : buildTurnOrder(state.players.length, state.startIndex, state.bigIndex, state.smallIndex);
  const activeFlow = turnOrder.filter((index) => isInHand(state.players[index]));
  const flowOrderNumber = activeFlow.indexOf(playerIndex) + 1;
  const role = getSeatRoles(playerIndex, state);
  const matchLabel = due === 0 ? "Check" : due > player.balance ? `Go all-in (${formatAmount(player.balance)})` : `Match ${formatAmount(due)}`;

  return (
    <aside className="action-panel" aria-label="Match controls">
      <div className="action-kicker">
        <span><span className="action-light" /> UP TO ACT</span>
        <span>TURN {String(flowOrderNumber).padStart(2, "0")} / {String(activeFlow.length).padStart(2, "0")}</span>
      </div>
      <div className="action-player">
        <span className="action-avatar">{initials(player.name)}</span>
        <div>
          <span className="action-player-label">{role.includes("starting") && role.includes("big") ? "STARTING PLAYER / BIG BLIND" : role.includes("starting") && role.includes("small") ? "STARTING PLAYER / SMALL BLIND" : role.includes("starting") ? "STARTING PLAYER" : role.includes("big") ? "BIG BLIND" : role.includes("small") ? "SMALL BLIND" : "PLAYER"}</span>
          <h2>{player.name}<span>'s turn.</span></h2>
        </div>
      </div>

      <div className="action-amounts">
        <div><span>TO MATCH</span><strong>{formatAmount(due)}</strong></div>
        <div><span>AVAILABLE</span><strong>{formatAmount(player.balance)}</strong></div>
      </div>

      <button className="primary-action" type="button" onClick={() => onAction("match")}>
        <span>{matchLabel}</span><ArrowUpRight size={20} strokeWidth={2} />
      </button>
      {due > player.balance && <p className="all-in-help">Not enough to fully match. This puts in your remaining chips.</p>}

      <div className="raise-section">
        <label className="raise-label" htmlFor="raise-amount">RAISE TO <span>TOTAL BET THIS ROUND</span></label>
        <div className="raise-row">
          <div className="raise-input-wrap">
            <input
              id="raise-amount"
              type="number"
              min={minRaise}
              max={maxRaise}
              step="1"
              inputMode="numeric"
              value={raiseValue}
              onChange={(event) => setRaiseValue(event.target.value)}
              disabled={maxRaise < minRaise}
              aria-label="Raise to total amount"
            />
          </div>
          <button className="raise-button" type="button" disabled={!validRaise} onClick={() => onAction("raise", raiseNumber)}>
            Raise <ArrowUpRight size={17} strokeWidth={2} />
          </button>
        </div>
        <p className="raise-help">
          {maxRaise < minRaise
            ? "Not enough chips to raise this round."
            : `Min ${formatAmount(minRaise)} / Max ${formatAmount(maxRaise)} chips`}
        </p>
      </div>

      <button className="fold-button" type="button" onClick={() => onAction("fold")}>
        Fold this hand <X size={17} strokeWidth={1.8} />
      </button>

      {lastSnapshot && (
        <button
          type="button"
          className="undo-secondary-btn"
          onClick={onUndoLastAction}
          title={`Undo ${lastSnapshot.actorName}'s ${lastSnapshot.summary}`}
        >
          <Undo2 size={14} strokeWidth={2} />
          <span>Undo last {lastSnapshot.actionKind === "adjust" ? "correction" : "move"} ({lastSnapshot.actorName}: {lastSnapshot.summary})</span>
        </button>
      )}

      <div className="showdown-footer">
        <span>READY TO FINISH THE HAND?</span>
        <button type="button" onClick={onShowdown}>End match / showdown <ArrowRight size={17} strokeWidth={1.8} /></button>
      </div>
    </aside>
  );
}

function HandHistory({ state }: { state: GameState }) {
  const [showAll, setShowAll] = useState(false);
  const results = showAll ? state.history : state.history.slice(0, 4);

  return (
    <section className="history-section" aria-labelledby="history-title">
      <div className="history-heading">
        <div><span className="eyebrow">THE RECORD</span><h2 id="history-title">Hand history</h2></div>
        {state.history.length > 4 && (
          <button type="button" className="history-toggle" onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Show less" : `View all ${state.history.length} hands`}
            {showAll ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>
      {results.length === 0 ? (
        <div className="history-empty"><span>01 /</span> Finished hands will appear here. Every pot has a paper trail.</div>
      ) : (
        <div className="history-list">
          {results.map((result) => (
            <div className="history-row" key={result.handNumber}>
              <span className="history-hand">HAND {handNumber(result.handNumber)}</span>
              <strong>{result.winnerName}</strong>
              <span className="history-reason">{result.reason === "fold" ? "Won by fold" : "Won at showdown"}</span>
              <span className="history-pot">+{formatAmount(result.pot)} <small>CHIPS</small></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerResponseModal({
  state,
  playerId,
  onClose,
  onAdjustBalance,
  onRollback,
  onEditAction,
  dialogRef,
}: {
  state: GameState;
  playerId: string | null;
  onClose: () => void;
  onAdjustBalance: (playerId: string, amount: number) => void;
  onRollback: (snapshotId: string) => void;
  onEditAction: (snapshotId: string, kind: "match" | "raise" | "fold", amount?: number) => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const player = state.players.find((p) => p.id === playerId);
  const [customRaiseAmount, setCustomRaiseAmount] = useState<Record<string, string>>({});
  const [balanceInput, setBalanceInput] = useState(() => String(player?.balance ?? ""));

  useEffect(() => {
    setBalanceInput(String(player?.balance ?? ""));
  }, [player?.id, player?.balance]);

  if (!player) return null;

  const playerIndex = state.players.findIndex((p) => p.id === player.id);
  const roles = getSeatRoles(playerIndex, state);
  const isCurrentTurn = state.currentTurnId === player.id;
  const playerSnapshots = (state.handSnapshots || []).filter((s) => s.actorId === player.id);
  const lastAdjustment = [...state.balanceAdjustments].reverse().find((entry) => entry.playerId === player.id);
  const newBalance = Number(balanceInput);
  const change = newBalance - player.balance;
  const totalChips = state.players.reduce((sum, current) => sum + current.balance, state.pot);
  const balanceValid =
    /^(0|[1-9]\d*)$/.test(balanceInput) &&
    Number.isSafeInteger(newBalance) &&
    Number.isSafeInteger(totalChips + change) &&
    Number.isSafeInteger(state.netAdjustments + change) &&
    newBalance !== player.balance;

  function saveBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!balanceValid) return;
    onAdjustBalance(player!.id, newBalance);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card edit-response-modal" role="dialog" aria-modal="true" aria-labelledby="player-response-title" ref={dialogRef}>
        <div className="modal-top">
          <span>HAND {handNumber(state.handNumber)} / PLAYER &amp; BANKROLL</span>
          <button type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </div>

        <div className="edit-modal-player-header">
          <span className="edit-modal-avatar">{initials(player.name)}</span>
          <div className="edit-modal-player-info">
            <div className="edit-modal-meta">
              <span className="edit-modal-seat">SEAT {String(playerIndex + 1).padStart(2, "0")}</span>
              {roles.map((role) => (
                <span className={`seat-role role-${role}`} key={role}>{shortRoles([role])}</span>
              ))}
              {player.folded && <span className="seat-status">FOLDED</span>}
              {player.sittingOut && <span className="seat-status">{player.balance === 0 ? "OUT OF CHIPS" : "NEXT HAND"}</span>}
            </div>
            <h2 id="player-response-title">{player.name}</h2>
          </div>
        </div>

        <div className="edit-modal-stats">
          <div>
            <small>REMAINING CHIPS</small>
            <strong>{formatAmount(player.balance)}</strong>
          </div>
          <div>
            <small>ROUND BET</small>
            <strong>{formatAmount(player.roundBet)}</strong>
          </div>
          <div>
            <small>TOTAL IN POT THIS HAND</small>
            <strong>{formatAmount(player.handBet)}</strong>
          </div>
        </div>

        <form className="balance-correction" onSubmit={saveBalance}>
          <div className="balance-correction-heading">
            <span className="field-label">CORRECT REMAINING STACK</span>
            <span className="balance-correction-overline">BANKROLL</span>
          </div>
          <div className="balance-correction-controls">
            <div className={`balance-correction-field ${balanceInput !== "" && !balanceValid && change !== 0 ? "field-invalid" : ""}`}>
              <input
                id="adjust-remaining-stack"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={balanceInput}
                onChange={(event) => setBalanceInput(event.target.value)}
                aria-label={`Set ${player.name}'s remaining chips`}
                aria-invalid={balanceInput !== "" && !balanceValid && change !== 0}
              />
              <span>CHIPS</span>
            </div>
            <button type="submit" className="balance-save-button" disabled={!balanceValid}>
              Save stack <ArrowUpRight size={16} strokeWidth={2} />
            </button>
          </div>
          {balanceInput !== "" && !balanceValid && change !== 0 && (
            <p className="balance-correction-error" role="alert">Enter a non-negative whole number within the safe chip limit.</p>
          )}
          <p className="balance-correction-help">
            {balanceValid && change !== 0 && <strong>{change > 0 ? "+" : ""}{formatAmount(change)} chips. </strong>}
            Only available chips change; bets and the pot stay untouched.
            {newBalance === 0 && balanceValid
              ? player.handBet > 0
                ? " Their committed chips remain in play. If still at zero after the hand, the next Big blind doubles."
                : " They sit out now. The next hand doubles the Big blind if still at zero."
              : player.sittingOut && newBalance > 0 && balanceValid
                ? " They return on the next hand."
                : ""}
          </p>
          {lastAdjustment && (
            <p className="balance-correction-last">
              Last correction: {formatAmount(lastAdjustment.previousBalance)} to {formatAmount(lastAdjustment.newBalance)} in hand {handNumber(lastAdjustment.handNumber)}
            </p>
          )}
        </form>

        {isCurrentTurn && (
          <div className="edit-modal-current-callout">
            <span className="live-light" />
            <div>
              <strong>It is currently {player.name}'s turn to act!</strong>
              <p>Use the Action Panel on the right to match, raise, or fold.</p>
            </div>
          </div>
        )}

        <div className="edit-modal-history-section">
          <div className="player-list-heading">
            <span className="field-label">ACTIVITY IN HAND #{handNumber(state.handNumber)}</span>
            <span className="minimum-label">{playerSnapshots.length} {playerSnapshots.length === 1 ? "ENTRY" : "ENTRIES"}</span>
          </div>
          {playerSnapshots.length > 0 && (
            <p className="edit-modal-history-note">Rewinding an entry also removes every later move and stack correction in this hand.</p>
          )}

          {playerSnapshots.length === 0 ? (
            <div className="edit-modal-empty">
              <p>{player.name} has no recorded changes in this hand yet.</p>
              <small>Betting responses and stack corrections appear here as they happen.</small>
            </div>
          ) : (
            <div className="edit-modal-actions-list">
              {[...playerSnapshots].reverse().map((snapshot, revIndex) => {
                if (snapshot.actionKind === "adjust") {
                  const previous = snapshot.beforeState.players.find((p) => p.id === player.id)?.balance;
                  return (
                    <div className="edit-modal-action-card edit-modal-adjustment-entry" key={snapshot.snapshotId}>
                      <div className="edit-modal-card-top">
                        <span className="edit-modal-round-tag">{snapshot.roundName}</span>
                        <strong className="edit-modal-action-summary">Stack corrected</strong>
                        <span className="edit-modal-action-num">#{playerSnapshots.length - revIndex}</span>
                      </div>
                      <p className="edit-modal-card-desc">
                        {formatAmount(previous ?? 0)} to {formatAmount(snapshot.actionAmount ?? 0)} remaining chips. The pot and bets did not change.
                      </p>
                      <button
                        type="button"
                        className="edit-rewind-btn"
                        onClick={() => { onRollback(snapshot.snapshotId); onClose(); }}
                      >
                        <Undo2 size={14} strokeWidth={2.2} /> Rewind to before correction
                      </button>
                    </div>
                  );
                }

                const snapRaiseInput = customRaiseAmount[snapshot.snapshotId] ?? String(snapshot.beforeState.highestBet + 100);
                const snapRaiseNum = Number(snapRaiseInput);
                const snapMinRaise = snapshot.beforeState.highestBet + 1;
                const snapActor = snapshot.beforeState.players.find((p) => p.id === player.id);
                const snapMaxRaise = snapActor ? snapActor.roundBet + snapActor.balance : 0;
                const canRaise = snapMaxRaise >= snapMinRaise;

                return (
                  <div className="edit-modal-action-card" key={snapshot.snapshotId}>
                    <div className="edit-modal-card-top">
                      <span className="edit-modal-round-tag">{snapshot.roundName}</span>
                      <strong className="edit-modal-action-summary">{snapshot.summary}</strong>
                      <span className="edit-modal-action-num">#{playerSnapshots.length - revIndex}</span>
                    </div>

                    <p className="edit-modal-card-desc">
                      Pot was {formatAmount(snapshot.beforeState.pot)} chips · Call was {formatAmount(snapshot.beforeState.highestBet)}
                    </p>

                    <div className="edit-modal-buttons">
                      <button
                        type="button"
                        className="edit-rewind-btn"
                        onClick={() => {
                          onRollback(snapshot.snapshotId);
                          onClose();
                        }}
                      >
                        <Undo2 size={14} strokeWidth={2.2} />
                        <span>Rewind hand to this turn &amp; decide</span>
                      </button>

                      <div className="edit-modal-quick-group">
                        <span className="edit-modal-quick-label">OR CHANGE RESPONSE DIRECTLY:</span>
                        <div className="edit-modal-quick-row">
                          <button
                            type="button"
                            className="edit-quick-btn edit-quick-match"
                            onClick={() => {
                              onEditAction(snapshot.snapshotId, "match");
                              onClose();
                            }}
                          >
                            Change to Check/Match
                          </button>
                          <button
                            type="button"
                            className="edit-quick-btn edit-quick-fold"
                            onClick={() => {
                              onEditAction(snapshot.snapshotId, "fold");
                              onClose();
                            }}
                          >
                            Change to Fold
                          </button>
                        </div>

                        {canRaise && (
                          <div className="edit-modal-raise-row">
                            <input
                              type="number"
                              min={snapMinRaise}
                              max={snapMaxRaise}
                              step="1"
                              value={snapRaiseInput}
                              onChange={(e) =>
                                setCustomRaiseAmount((curr) => ({
                                  ...curr,
                                  [snapshot.snapshotId]: e.target.value,
                                }))
                              }
                              aria-label="New raise amount"
                            />
                            <button
                              type="button"
                              className="edit-quick-btn edit-quick-raise"
                              disabled={!Number.isSafeInteger(snapRaiseNum) || snapRaiseNum < snapMinRaise || snapRaiseNum > snapMaxRaise}
                              onClick={() => {
                                onEditAction(snapshot.snapshotId, "raise", snapRaiseNum);
                                onClose();
                              }}
                            >
                              Raise to {snapRaiseNum || snapMinRaise}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="modal-confirm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function GameScreen({
  state,
  dispatch,
  onShowdown,
  onOpenRoles,
  onSelectPlayer,
}: {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  onShowdown: () => void;
  onOpenRoles: () => void;
  onSelectPlayer: (playerId: string) => void;
}) {
  function onAction(kind: "match" | "raise" | "fold", amount?: number) {
    if (!state.currentTurnId) return;
    dispatch({
      type: "ACT",
      kind,
      playerId: state.currentTurnId,
      handNumber: state.handNumber,
      roundIndex: state.roundIndex,
      amount,
    });
  }

  return (
    <main className="game-main">
      <div className="game-intro">
        <div>
          <div className="eyebrow game-eyebrow"><span className="eyebrow-line" /> THE LIVE TABLE</div>
          <h1>The table is live<span>.</span></h1>
          <p>Every chip accounted for. Click a player card to edit a move or correct their stack.</p>
        </div>
        <div className="hand-number-block"><span>CURRENT HAND</span><strong>{handNumber(state.handNumber)}</strong></div>
      </div>

      <div className="round-progress" aria-label={`Current betting round: ${ROUND_NAMES[state.roundIndex]}`}>
        {ROUND_NAMES.map((round, index) => (
          <div className={`round-step ${index === state.roundIndex ? "round-current" : ""} ${index < state.roundIndex ? "round-done" : ""}`} key={round}>
            <span className="round-track"><span /></span>
            <span className="round-step-label"><small>{String(index + 1).padStart(2, "0")}</small>{round}</span>
          </div>
        ))}
      </div>

      <div className="game-layout">
        <TableSurface
          state={state}
          onOpenRoles={onOpenRoles}
          onSelectPlayer={onSelectPlayer}
        />
        <ActionPanel
          state={state}
          onAction={onAction}
          onShowdown={onShowdown}
          onUndoLastAction={() => dispatch({ type: "UNDO_LAST_ACTION" })}
        />
      </div>
      <HandHistory state={state} />

      {state.lastResult && (
        <div className="result-toast" role="status">
          <span className="result-check"><Check size={19} strokeWidth={2} /></span>
          <div>
            <strong>{state.lastResult.winnerName} took the pot.</strong>
            <span>Hand {handNumber(state.lastResult.handNumber)} / +{formatAmount(state.lastResult.pot)} chips ({state.lastResult.reason === "fold" ? "by fold" : "at showdown"})</span>
          </div>
          {state.previousHandState && (
            <button
              type="button"
              className="undo-result-toast-btn"
              onClick={() => dispatch({ type: "UNDO_HAND_RESULT" })}
              title="Undo this result and return to the hand"
            >
              <Undo2 size={13} strokeWidth={2.2} /> Undo
            </button>
          )}
          <button type="button" aria-label="Dismiss result" onClick={() => dispatch({ type: "DISMISS_RESULT" })}><X size={17} /></button>
        </div>
      )}
    </main>
  );
}

function GameOverScreen({ state, onRestart, onUndo }: { state: GameState; onRestart: () => void; onUndo: () => void }) {
  const winner = state.players.find((player) => player.id === state.winnerId);
  const finalStandings = [...state.players].sort((a, b) => b.balance - a.balance);
  const canUndoCorrection = !state.lastResult && state.handSnapshots.at(-1)?.actionKind === "adjust";
  const canUndoResult = !!state.lastResult && !!state.previousHandState;

  return (
    <main className="game-over-main">
      <section className="victory-section">
        <div className="victory-emblem"><Trophy size={34} strokeWidth={1.4} /></div>
        <div className="eyebrow victory-eyebrow"><span className="eyebrow-line" /> SESSION COMPLETE</div>
        <p className="victory-intro">The table belongs to</p>
        <h1>{winner?.name ?? "The winner"}<span>.</span></h1>
        <p className="victory-description">
          {state.winReason === "target"
            ? `${winner?.name ?? "They"} reached the winning balance of ${formatAmount((state.players.length - 1) * state.startingAmount)} chips.`
            : `${winner?.name ?? "They"} is the last player with chips at the table.`}
        </p>
        <div className="victory-balance"><span>FINAL STACK</span><strong>{formatAmount(winner?.balance ?? 0)}</strong><span>CHIPS</span></div>
        <button className="restart-button" type="button" onClick={onRestart}>Start a new game <ArrowUpRight size={20} strokeWidth={2} /></button>
        {(canUndoCorrection || canUndoResult) && (
          <button className="victory-undo" type="button" onClick={onUndo}>
            <Undo2 size={15} strokeWidth={1.9} /> Undo last {canUndoCorrection ? "stack correction" : "hand result"}
          </button>
        )}
      </section>
      <section className="final-ledger" aria-labelledby="final-ledger-title">
        <div className="final-ledger-heading"><span className="eyebrow">THE FINAL COUNT</span><h2 id="final-ledger-title">Table standings</h2><p>{state.history.length} {state.history.length === 1 ? "hand" : "hands"} completed</p></div>
        <div className="final-rows">
          {finalStandings.map((player, index) => (
            <div className="final-row" key={player.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{player.name}{player.id === state.winnerId && <span className="winner-tag">WINNER</span>}</strong>
              <span>{formatAmount(player.balance)} <small>CHIPS</small></span>
            </div>
          ))}
        </div>
        {state.pot > 0 && <p className="unsettled-pot">Unsettled pot: {formatAmount(state.pot)} chips were committed when the winning balance was reached.</p>}
      </section>
    </main>
  );
}

function ShowdownModal({
  state,
  selectedId,
  onSelect,
  nextRoles,
  onChangeNextRoles,
  onClose,
  onConfirm,
  dialogRef,
}: {
  state: GameState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  nextRoles: RoleSelection;
  onChangeNextRoles: (next: RoleSelection) => void;
  onClose: () => void;
  onConfirm: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const eligible = state.players.filter(isInHand);
  const playerNames = state.players.map((player) => player.name);
  const nextHandFunded = selectedId
    ? state.players
        .map((player, index) => player.balance + (player.id === selectedId ? state.pot : 0) > 0 ? index : -1)
        .filter((index) => index !== -1)
    : [];

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="showdown-title" ref={dialogRef}>
        <div className="modal-top"><span>HAND {handNumber(state.handNumber)} / SHOWDOWN</span><button type="button" onClick={onClose} aria-label="Close showdown"><X size={19} /></button></div>
        <h2 id="showdown-title">Who takes the pot?</h2>
        <p className="modal-description">Select a player still in the hand. The full pot will be added to their stack, then the next hand begins.</p>
        <div className="modal-pot"><span>POT TO AWARD</span><strong>{formatAmount(state.pot)} <small>CHIPS</small></strong></div>
        <div className="winner-options" role="radiogroup" aria-label="Select hand winner">
          {eligible.map((player) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === player.id}
              className={`winner-option ${selectedId === player.id ? "winner-option-selected" : ""}`}
              key={player.id}
              onClick={() => onSelect(player.id)}
            >
              <span className="winner-option-avatar">{initials(player.name)}</span>
              <span className="winner-option-name">{player.name}<small>{formatAmount(player.balance)} chips available</small></span>
              <span className="winner-radio">{selectedId === player.id && <Check size={14} strokeWidth={2.5} />}</span>
            </button>
          ))}
        </div>

        <div className="modal-roles-section">
          <div className="player-list-heading">
            <span className="field-label">NEXT HAND ROLES</span>
            <span className="minimum-label">OUT PLAYERS ARE SKIPPED</span>
          </div>
          {!selectedId ? (
            <p className="modal-roles-help">Select a winner to see who posts the next blinds.</p>
          ) : nextHandFunded.length < 2 ? (
            <p className="modal-roles-help">This award leaves one player with chips. There is no next hand.</p>
          ) : (
            <RoleSelectorGroup
              names={playerNames}
              roles={nextRoles}
              onChange={onChangeNextRoles}
              idPrefix="showdown-next"
              eligibleIndices={nextHandFunded}
            />
          )}
        </div>

        <div className="modal-actions"><button type="button" className="modal-cancel" onClick={onClose}>Cancel</button><button type="button" className="modal-confirm" disabled={!selectedId} onClick={onConfirm}>Award pot <ArrowUpRight size={18} /></button></div>
      </div>
    </div>
  );
}

function RolesModal({
  state,
  roles,
  onChange,
  onClose,
  onConfirm,
  dialogRef,
}: {
  state: GameState;
  roles: RoleSelection;
  onChange: (next: RoleSelection) => void;
  onClose: () => void;
  onConfirm: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
}) {
  const playerNames = state.players.map((player) => player.name);
  const fundedBeforeBlinds = state.players
    .map((player, index) => player.balance + player.handBet > 0 ? index : -1)
    .filter((index) => index !== -1);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="roles-title" ref={dialogRef}>
        <div className="modal-top"><span>HAND {handNumber(state.handNumber)} / ROLES</span><button type="button" onClick={onClose} aria-label="Close roles dialog"><X size={19} /></button></div>
        <h2 id="roles-title">Assign hand roles.</h2>
        <p className="modal-description">
          Select Start, Big, and Small. Start acts first and can also post a blind; Big and Small must be different players.
        </p>
        <div className="modal-roles-section">
          <RoleSelectorGroup
            names={playerNames}
            roles={roles}
            onChange={onChange}
            idPrefix="hand-roles"
            eligibleIndices={fundedBeforeBlinds}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="modal-confirm" onClick={onConfirm}>Apply roles <ArrowUpRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}

function ResetModal({ onClose, onConfirm, dialogRef }: {
  onClose: () => void;
  onConfirm: () => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" ref={dialogRef}>
        <div className="modal-top"><span>NEW SESSION</span><button type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
        <h2 id="reset-title">Clear the table?</h2>
        <p className="modal-description">This will remove the current game, all player balances and the hand history. You cannot undo this.</p>
        <div className="modal-actions"><button type="button" className="modal-cancel" onClick={onClose}>Keep playing</button><button type="button" className="modal-confirm" onClick={onConfirm}>Start fresh <ArrowUpRight size={18} /></button></div>
      </div>
    </div>
  );
}

export default function App() {
  const [game, dispatch] = useReducer(gameReducer, INITIAL_GAME, loadSavedGame);
  const [modal, setModal] = useState<"showdown" | "reset" | "roles" | "editPlayer" | null>(null);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);
  const [selectedPlayerForEdit, setSelectedPlayerForEdit] = useState<string | null>(null);
  const [pendingRoles, setPendingRoles] = useState<RoleSelection>({
    startIndex: 0,
    bigIndex: 1,
    smallIndex: 2,
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (game.phase === "setup") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    } catch {
      // The table remains usable when private browsing blocks local storage.
    }
  }, [game]);

  useEffect(() => {
    if (!game.lastResult || game.phase !== "playing") return;
    const timeout = window.setTimeout(() => dispatch({ type: "DISMISS_RESULT" }), 6500);
    return () => window.clearTimeout(timeout);
  }, [game.lastResult, game.phase]);

  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled])"),
      ];
      if (focusable.length === 0) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [modal]);

  function resetGame() {
    setModal(null);
    dispatch({ type: "RESET" });
  }

  function openShowdown() {
    setSelectedWinnerId(null);
    setPendingRoles(nextHandRoles(game));
    setModal("showdown");
  }

  function selectShowdownWinner(winnerId: string) {
    setSelectedWinnerId(winnerId);
    const playersAfterPayout = game.players.map((player) =>
      player.id === winnerId ? { ...player, balance: player.balance + game.pot } : player,
    );
    setPendingRoles(nextHandRoles({ ...game, players: playersAfterPayout }));
  }

  function openRolesModal() {
    setPendingRoles({
      startIndex: game.startIndex,
      bigIndex: game.bigIndex,
      smallIndex: game.smallIndex,
    });
    setModal("roles");
  }

  function openPlayerEdit(playerId: string) {
    setSelectedPlayerForEdit(playerId);
    setModal("editPlayer");
  }

  function confirmShowdown() {
    if (!selectedWinnerId) return;
    dispatch({
      type: "SHOWDOWN",
      winnerId: selectedWinnerId,
      handNumber: game.handNumber,
      nextRoles: pendingRoles,
    });
    setModal(null);
    setSelectedWinnerId(null);
  }

  function confirmRolesModal() {
    dispatch({
      type: "SET_ROLES",
      startIndex: pendingRoles.startIndex,
      bigIndex: pendingRoles.bigIndex,
      smallIndex: pendingRoles.smallIndex,
    });
    setModal(null);
  }

  return (
    <div className={`app-shell ${game.phase === "gameOver" ? "app-shell-victory" : ""}`}>
      <Header phase={game.phase} onReset={() => setModal("reset")} />
      {game.phase === "setup" && (
        <SetupScreen
          onStart={(names, startingAmount, roles) =>
            dispatch({
              type: "START",
              names,
              startingAmount,
              startIndex: roles.startIndex,
              bigIndex: roles.bigIndex,
              smallIndex: roles.smallIndex,
            })
          }
        />
      )}
      {game.phase === "playing" && (
        <GameScreen
          state={game}
          dispatch={dispatch}
          onShowdown={openShowdown}
          onOpenRoles={openRolesModal}
          onSelectPlayer={openPlayerEdit}
        />
      )}
      {game.phase === "gameOver" && (
        <GameOverScreen
          state={game}
          onRestart={resetGame}
          onUndo={() => dispatch({ type: game.lastResult ? "UNDO_HAND_RESULT" : "UNDO_LAST_ACTION" })}
        />
      )}
      {modal === "showdown" && game.phase === "playing" && (
        <ShowdownModal
          state={game}
          selectedId={selectedWinnerId}
          onSelect={selectShowdownWinner}
          nextRoles={pendingRoles}
          onChangeNextRoles={setPendingRoles}
          onClose={() => setModal(null)}
          onConfirm={confirmShowdown}
          dialogRef={dialogRef}
        />
      )}
      {modal === "roles" && game.phase === "playing" && (
        <RolesModal
          state={game}
          roles={pendingRoles}
          onChange={setPendingRoles}
          onClose={() => setModal(null)}
          onConfirm={confirmRolesModal}
          dialogRef={dialogRef}
        />
      )}
      {modal === "editPlayer" && game.phase === "playing" && (
        <PlayerResponseModal
          state={game}
          playerId={selectedPlayerForEdit}
          onClose={() => setModal(null)}
          onAdjustBalance={(playerId, amount) =>
            dispatch({ type: "ADJUST_BALANCE", playerId, handNumber: game.handNumber, amount })
          }
          onRollback={(snapshotId) => dispatch({ type: "ROLLBACK_TO_SNAPSHOT", snapshotId })}
          onEditAction={(snapshotId, kind, amount) => dispatch({ type: "EDIT_ACTION", snapshotId, kind, amount })}
          dialogRef={dialogRef}
        />
      )}
      {modal === "reset" && <ResetModal onClose={() => setModal(null)} onConfirm={resetGame} dialogRef={dialogRef} />}
    </div>
  );
}
