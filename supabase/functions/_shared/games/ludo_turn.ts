// Server-side turns for online Ludo. The server rolls the dice and applies every move,
// so a player's device can't choose a roll, move out of turn or declare a winner.
import {
  initializeGame,
  moveToken,
  rollDice,
  type LudoGameState,
  type LudoPlayerId,
} from "./ludo.ts";

export type LudoSide = "creator" | "opponent";
export type LudoPlay = { type: "roll" } | { type: "move"; tokenIndex: number };

export interface ServerLudoBoard {
  engine: LudoGameState;
  turn: LudoSide;
  winner: LudoSide | null;
  moveCount: number;
  lastAction: string;
}

export type LudoPlayResult =
  | { ok: true; board: ServerLudoBoard; dice: number | null }
  | { ok: false; error: string; status: number };

const SEATS: Record<LudoSide, LudoPlayerId> = { creator: "RED", opponent: "YELLOW" };
const HISTORY_KEPT = 40;

const sideOf = (color: LudoPlayerId): LudoSide => (color === SEATS.creator ? "creator" : "opponent");

const toBoard = (engine: LudoGameState): ServerLudoBoard => {
  const trimmed = { ...engine, turnHistory: engine.turnHistory.slice(-HISTORY_KEPT) };
  return {
    engine: trimmed,
    turn: sideOf(engine.currentPlayer),
    winner: engine.winner ? sideOf(engine.winner) : null,
    moveCount: engine.moveCount,
    lastAction: trimmed.turnHistory[trimmed.turnHistory.length - 1]?.summary || "",
  };
};

export function createServerLudoBoard(creatorName: string, opponentName: string): ServerLudoBoard {
  return toBoard(
    initializeGame({
      players: [SEATS.creator, SEATS.opponent],
      startingPlayer: SEATS.creator,
      playerNames: { RED: creatorName, YELLOW: opponentName },
    }),
  );
}

export function isValidLudoBoard(value: unknown): value is ServerLudoBoard {
  const engine = (value as ServerLudoBoard | null)?.engine;
  if (!engine || !Array.isArray(engine.players) || !engine.tokens) return false;
  return engine.players.length === 2 &&
    engine.players.every((color) => Array.isArray(engine.tokens[color]) && engine.tokens[color].length === 4);
}

export function applyLudoPlay(
  board: ServerLudoBoard,
  side: LudoSide,
  play: LudoPlay,
  rollDie: () => number,
): LudoPlayResult {
  if (!isValidLudoBoard(board)) return { ok: false, error: "This match board is not valid.", status: 409 };
  if (board.winner) return { ok: false, error: "This match is already decided.", status: 409 };

  const color = SEATS[side];
  if (board.engine.currentPlayer !== color) return { ok: false, error: "It is not your turn.", status: 409 };

  if (play?.type === "roll") {
    const rolled = rollDice(board.engine, color, rollDie());
    if (rolled.error) return { ok: false, error: rolled.error, status: 400 };
    return { ok: true, board: toBoard(rolled.state), dice: rolled.diceValue };
  }

  if (play?.type === "move" && Number.isInteger(play.tokenIndex)) {
    const moved = moveToken(board.engine, color, play.tokenIndex);
    if (moved.error) return { ok: false, error: moved.error, status: 400 };
    return { ok: true, board: toBoard(moved.state), dice: null };
  }

  return { ok: false, error: "That move is not legal.", status: 400 };
}

/** A fair die: discards the top byte values so all six faces are equally likely. */
export function secureDieRoll(): number {
  const byte = new Uint8Array(1);
  do {
    crypto.getRandomValues(byte);
  } while (byte[0] >= 252);
  return (byte[0] % 6) + 1;
}
