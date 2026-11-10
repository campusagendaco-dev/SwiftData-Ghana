import { describe, expect, it } from "vitest";
import {
  FINAL_HOME_STEP,
  calculateLegalMoves,
  initializeGame,
  moveToken,
  rollDice,
  stepsToTrackIndex,
  type LudoGameState,
  type LudoPlayerId,
} from "../../supabase/functions/_shared/games/ludo";

/** Small seeded generator, so a failing game can be reproduced exactly. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Returns a description of the first broken rule, or null. Plain checks keep thousands of games fast. */
const findProblem = (game: LudoGameState): string | null => {
  if (game.currentPlayer !== game.players[game.currentPlayerIndex]) return "current player mismatch";
  for (const player of game.players) {
    if (game.tokens[player].length !== 4) return `${player} does not have 4 tokens`;
    for (const token of game.tokens[player]) {
      const { status, stepsFromStart: steps, trackPosition: track, homePathPosition: home } = token;
      const ok =
        status === "BASE" ? steps === -1 && track === null && home === 0
        : status === "ACTIVE" ? steps >= 0 && steps <= 50 && track === stepsToTrackIndex(player, steps)
        : status === "HOME_PATH" ? steps >= 51 && steps <= 55 && track === null && home === steps - 50
        : steps === FINAL_HOME_STEP && track === null && home === 6;
      if (!ok) return `bad token ${token.id}: ${JSON.stringify(token)}`;
    }
  }
  return null;
};

const playRandomGame = (players: LudoPlayerId[], seed: number, blockades: boolean) => {
  const random = seeded(seed);
  let game = initializeGame({ players, config: { blockadeRulesEnabled: blockades } });
  for (let turn = 0; turn < 40000 && !game.winner; turn++) {
    const dice = Math.floor(random() * 6) + 1;
    const rolled = rollDice(game, game.currentPlayer, dice);
    if (rolled.error) throw new Error(`seed ${seed}: ${rolled.error}`);
    game = rolled.state;
    const afterRoll = findProblem(game);
    if (afterRoll) throw new Error(`seed ${seed}: ${afterRoll}`);
    if (rolled.legalMoves.length === 0) continue;

    const move = rolled.legalMoves[Math.floor(random() * rolled.legalMoves.length)];
    for (const id of move.willCaptureTokenIds) {
      if (game.safeSquares.includes(move.toTrackPosition as number)) throw new Error(`seed ${seed}: captured on a safe square`);
      if (id.startsWith(move.owner)) throw new Error(`seed ${seed}: captured own token`);
    }
    const moved = moveToken(game, move.owner, move.tokenIndex);
    if (moved.error) throw new Error(`seed ${seed}: ${moved.error}`);
    game = moved.state;
    const afterMove = findProblem(game);
    if (afterMove) throw new Error(`seed ${seed}: ${afterMove}`);
  }
  return game;
};

describe("Ludo random full games", () => {
  it.each([
    [["RED", "YELLOW"] as LudoPlayerId[], false],
    [["RED", "GREEN", "YELLOW"] as LudoPlayerId[], false],
    [["RED", "GREEN", "YELLOW", "BLUE"] as LudoPlayerId[], false],
    [["RED", "GREEN", "YELLOW", "BLUE"] as LudoPlayerId[], true],
  ])("%j with blockades %s always finish with a real winner", (players, blockades) => {
    for (let seed = 1; seed <= 500; seed++) {
      const game = playRandomGame(players, seed, blockades);
      if (!game.winner) throw new Error(`seed ${seed}: game never finished`);
      if (!game.tokens[game.winner].every((t) => t.status === "FINISHED")) throw new Error(`seed ${seed}: false winner`);
    }
  }, 60000);
});

describe("Ludo illegal actions", () => {
  it("refuses a roll from the wrong player", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    expect(rollDice(game, "YELLOW", 6).error).toBeDefined();
  });

  it("refuses a second roll before moving", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    const rolled = rollDice(game, "RED", 6);
    expect(rolled.legalMoves.length).toBeGreaterThan(0);
    expect(rollDice(rolled.state, "RED", 3).error).toBeDefined();
  });

  it("refuses a move with no dice rolled", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    expect(moveToken(game, "RED", 0).error).toBeDefined();
  });

  it("refuses a token that has no legal move for that roll", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    const rolled = rollDice(game, "RED", 6);
    expect(moveToken(rolled.state, "RED", 9).error).toBeDefined();
  });

  it("refuses moving another player's token", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    const rolled = rollDice(game, "RED", 6);
    expect(moveToken(rolled.state, "YELLOW", 0).error).toBeDefined();
  });

  it("needs a 6 to leave base", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    for (const dice of [1, 2, 3, 4, 5]) {
      expect(calculateLegalMoves({ ...game, diceResult: dice }, "RED")).toHaveLength(0);
    }
  });

  it("rejects dice values outside 1 to 6", () => {
    const game = initializeGame({ players: ["RED", "YELLOW"], startingPlayer: "RED" });
    expect(rollDice(game, "RED", 7).error).toBeDefined();
    expect(rollDice(game, "RED", 0).error).toBeDefined();
  });
});
