import { describe, expect, it } from "vitest";
import {
  applyLudoPlay,
  createServerLudoBoard,
  isValidLudoBoard,
  secureDieRoll,
  type LudoSide,
} from "../../supabase/functions/_shared/games/ludo_turn";

const fixedDie = (value: number) => () => value;

describe("server Ludo turns", () => {
  it("starts with the creator to play", () => {
    const board = createServerLudoBoard("Kofi", "Ama");
    expect(board.turn).toBe("creator");
    expect(board.winner).toBeNull();
    expect(isValidLudoBoard(board)).toBe(true);
  });

  it("uses the server's dice, not the player's", () => {
    const board = createServerLudoBoard("Kofi", "Ama");
    const result = applyLudoPlay(board, "creator", { type: "roll", dice: 6 } as never, fixedDie(3));
    expect(result.ok && result.dice).toBe(3);
  });

  it("refuses a player acting out of turn", () => {
    const result = applyLudoPlay(createServerLudoBoard("Kofi", "Ama"), "opponent", { type: "roll" }, fixedDie(6));
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("passes the turn when a roll has no move", () => {
    const result = applyLudoPlay(createServerLudoBoard("Kofi", "Ama"), "creator", { type: "roll" }, fixedDie(3));
    expect(result.ok && result.board.turn).toBe("opponent");
  });

  it("moves a token after a valid roll", () => {
    const rolled = applyLudoPlay(createServerLudoBoard("Kofi", "Ama"), "creator", { type: "roll" }, fixedDie(6));
    if (!rolled.ok) throw new Error((rolled as { error: string }).error);
    const moved = applyLudoPlay(rolled.board, "creator", { type: "move", tokenIndex: 0 }, fixedDie(1));
    if (!moved.ok) throw new Error((moved as { error: string }).error);
    expect(moved.board.engine.tokens.RED[0].status).toBe("ACTIVE");
    expect(moved.board.turn).toBe("creator");
  });

  it.each([-1, 4, 1.5, "0", null])("refuses token index %s", (tokenIndex) => {
    const rolled = applyLudoPlay(createServerLudoBoard("Kofi", "Ama"), "creator", { type: "roll" }, fixedDie(6));
    if (!rolled.ok) throw new Error((rolled as { error: string }).error);
    expect(applyLudoPlay(rolled.board, "creator", { type: "move", tokenIndex } as never, fixedDie(1)).ok).toBe(false);
  });

  it("refuses an unknown action", () => {
    expect(applyLudoPlay(createServerLudoBoard("Kofi", "Ama"), "creator", { type: "win" } as never, fixedDie(1)).ok).toBe(false);
  });

  it.each([null, {}, { engine: {} }, { engine: { players: ["RED"], tokens: {} } }])("refuses a damaged board", (board) => {
    expect(applyLudoPlay(board as never, "creator", { type: "roll" }, fixedDie(1))).toMatchObject({ ok: false });
  });

  it("refuses play after the game is decided", () => {
    const decided = { ...createServerLudoBoard("Kofi", "Ama"), winner: "creator" as const };
    expect(applyLudoPlay(decided, "creator", { type: "roll" }, fixedDie(1))).toMatchObject({ ok: false, status: 409 });
  });

  it("keeps saved history short", () => {
    let board = createServerLudoBoard("Kofi", "Ama");
    for (let i = 0; i < 120; i++) {
      const result = applyLudoPlay(board, board.turn, { type: "roll" }, fixedDie(3));
      if (!result.ok) throw new Error((result as { error: string }).error);
      board = result.board;
    }
    expect(board.engine.turnHistory.length).toBeLessThanOrEqual(40);
  });

  it("plays whole games to a real winner, refusing the other side every turn", () => {
    for (let seed = 1; seed <= 200; seed++) {
      let n = seed;
      const random = () => { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; };
      let board = createServerLudoBoard("Kofi", "Ama");
      for (let turn = 0; turn < 40000 && !board.winner; turn++) {
        const other: LudoSide = board.turn === "creator" ? "opponent" : "creator";
        if (applyLudoPlay(board, other, { type: "roll" }, fixedDie(6)).ok) throw new Error(`seed ${seed}: wrong side played`);
        const rolled = applyLudoPlay(board, board.turn, { type: "roll" }, () => Math.floor(random() * 6) + 1);
        if (!rolled.ok) throw new Error(`seed ${seed}: ${(rolled as { error: string }).error}`);
        board = rolled.board;
        const moves = board.engine.legalMoves;
        if (moves.length === 0) continue;
        const moved = applyLudoPlay(board, board.turn, { type: "move", tokenIndex: moves[Math.floor(random() * moves.length)].tokenIndex }, fixedDie(1));
        if (!moved.ok) throw new Error(`seed ${seed}: ${(moved as { error: string }).error}`);
        board = moved.board;
      }
      if (!board.winner) throw new Error(`seed ${seed}: never finished`);
    }
  }, 30000);
});

describe("secureDieRoll", () => {
  it("only produces 1 to 6 and reaches every face", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(secureDieRoll());
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
