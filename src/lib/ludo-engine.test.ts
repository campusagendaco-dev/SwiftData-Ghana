import { describe, it, expect } from "vitest";
import {
  initializeGame,
  rollDice,
  validateDiceRoll,
  calculateLegalMoves,
  validateMove,
  moveToken,
  captureOpponent,
  checkSafeSquare,
  checkBlockade,
  enterHomePath,
  checkWinningCondition,
  grantExtraTurn,
  switchPlayer,
  updateGameState,
  endGame,
  FINAL_HOME_STEP,
  LAST_MAIN_TRACK_STEP,
} from "./ludo-engine";

describe("Complete Rule-Based Ludo Gameplay Engine (13-Section Specification)", () => {
  it("1. Rolling 1–5 while all tokens are in BASE automatically passes turn", () => {
    const game = initializeGame({ players: ["RED", "GREEN", "YELLOW", "BLUE"] });
    expect(game.currentPlayer).toBe("RED");

    const res = rollDice(game, "RED", 4);
    expect(res.legalMoves).toHaveLength(0);
    expect(res.autoPassed).toBe(true);
    expect(res.state.currentPlayer).toBe("GREEN");
    expect(res.state.diceResult).toBeNull();
  });

  it("2. Rolling 6 launches token from BASE to starting cell and grants extra turn", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });
    const rollRes = rollDice(game, "RED", 6);
    expect(rollRes.legalMoves).toHaveLength(4);
    expect(rollRes.autoPassed).toBe(false);

    const moveRes = moveToken(rollRes.state, "RED", 0);
    expect(moveRes.error).toBeUndefined();
    expect(moveRes.earnedExtraTurn).toBe(true);
    expect(moveRes.state.currentPlayer).toBe("RED");
    expect(moveRes.state.tokens.RED[0].status).toBe("ACTIVE");
    expect(moveRes.state.tokens.RED[0].stepsFromStart).toBe(0);
    expect(moveRes.state.tokens.RED[0].trackPosition).toBe(0);
  });

  it("3 & 4. Moving around complete 52-cell track and entering private 6-cell home path", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });
    // Launch RED-0
    game = rollDice(game, "RED", 6).state;
    game = moveToken(game, "RED", 0).state;

    // Place RED-0 at step 49 (trackPosition 49)
    game.tokens.RED[0] = {
      ...game.tokens.RED[0],
      status: "ACTIVE",
      stepsFromStart: 49,
      trackPosition: 49,
    };

    // Roll 3 -> stepsFromStart becomes 52 (HOME_PATH position 2)
    game = rollDice(game, "RED", 3).state;
    const moveRes = moveToken(game, "RED", 0);
    expect(moveRes.state.tokens.RED[0].status).toBe("HOME_PATH");
    expect(moveRes.state.tokens.RED[0].stepsFromStart).toBe(52);
    expect(moveRes.state.tokens.RED[0].trackPosition).toBeNull();
    expect(moveRes.state.tokens.RED[0].homePathPosition).toBe(2);
  });

  it("5 & 6. Exact home arrival vs Overshooting home", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });
    game.tokens.RED[0] = {
      ...game.tokens.RED[0],
      status: "HOME_PATH",
      stepsFromStart: 54, // Needs exact 2 to reach 56 (FINAL_HOME_STEP)
      trackPosition: null,
      homePathPosition: 4,
    };

    // Roll 3 -> overshoots 56! Since all other RED tokens are in BASE, no legal move exists -> auto-pass
    const overshootRoll = rollDice(game, "RED", 3);
    expect(overshootRoll.legalMoves).toHaveLength(0);
    expect(overshootRoll.autoPassed).toBe(true);
    expect(overshootRoll.state.currentPlayer).toBe("YELLOW");

    // Switch back to RED and roll exact 2 -> reaches FINISHED (56)
    let redTurn = switchPlayer(overshootRoll.state);
    redTurn = rollDice(redTurn, "RED", 2).state;
    expect(redTurn.legalMoves).toHaveLength(1);
    const finishMove = moveToken(redTurn, "RED", 0);
    expect(finishMove.state.tokens.RED[0].status).toBe("FINISHED");
    expect(finishMove.state.tokens.RED[0].stepsFromStart).toBe(FINAL_HOME_STEP);
    expect(finishMove.state.tokens.RED[0].homePathPosition).toBe(6);
  });

  it("7. Capturing opponent on a non-safe square sends opponent to BASE and grants extra turn", () => {
    let game = initializeGame({ players: ["RED", "GREEN"] });
    // RED-0 at trackPosition 10 (step 10)
    game.tokens.RED[0] = {
      ...game.tokens.RED[0],
      status: "ACTIVE",
      stepsFromStart: 10,
      trackPosition: 10,
    };
    // GREEN-0 at trackPosition 14 (step 1 from GREEN's start at 13; 14 is NOT a safe square)
    game.tokens.GREEN[0] = {
      ...game.tokens.GREEN[0],
      status: "ACTIVE",
      stepsFromStart: 1,
      trackPosition: 14,
    };

    game = rollDice(game, "RED", 4).state;
    const moveRes = moveToken(game, "RED", 0);
    expect(moveRes.capturedTokenIds).toEqual(["GREEN-0"]);
    expect(moveRes.earnedExtraTurn).toBe(true);
    expect(moveRes.state.currentPlayer).toBe("RED");
    expect(moveRes.state.tokens.GREEN[0].status).toBe("BASE");
    expect(moveRes.state.tokens.GREEN[0].stepsFromStart).toBe(-1);
  });

  it("8. Landing on safe squares (starting squares & star squares) protects tokens from capture", () => {
    let game = initializeGame({ players: ["RED", "GREEN"] });
    // Square 8 is a star safe square; Square 13 is GREEN's starting safe square
    expect(checkSafeSquare(game, 8)).toBe(true);
    expect(checkSafeSquare(game, 13)).toBe(true);

    // Place GREEN-0 on safe square 13 (GREEN start) and RED-0 at trackPosition 9
    game.tokens.GREEN[0] = {
      ...game.tokens.GREEN[0],
      status: "ACTIVE",
      stepsFromStart: 0,
      trackPosition: 13,
    };
    game.tokens.RED[0] = {
      ...game.tokens.RED[0],
      status: "ACTIVE",
      stepsFromStart: 9,
      trackPosition: 9,
    };

    // RED rolls 4 and lands on square 13 -> both co-exist safely without capture!
    game = rollDice(game, "RED", 4).state;
    const moveRes = moveToken(game, "RED", 0);
    expect(moveRes.capturedTokenIds).toHaveLength(0);
    expect(moveRes.state.tokens.GREEN[0].status).toBe("ACTIVE");
    expect(moveRes.state.tokens.RED[0].trackPosition).toBe(13);
  });

  it("9 & 10. Multiple tokens of same player form a Blockade that opponents cannot pass or land on", () => {
    let game = initializeGame({ players: ["RED", "GREEN"] });
    // GREEN puts 2 tokens on trackPosition 15 (forming a GREEN blockade)
    game.tokens.GREEN[0] = {
      ...game.tokens.GREEN[0],
      status: "ACTIVE",
      stepsFromStart: 2,
      trackPosition: 15,
    };
    game.tokens.GREEN[1] = {
      ...game.tokens.GREEN[1],
      status: "ACTIVE",
      stepsFromStart: 2,
      trackPosition: 15,
    };

    const blk = checkBlockade(game, 15);
    expect(blk.isBlockade).toBe(true);
    expect(blk.owner).toBe("GREEN");
    expect(blk.count).toBe(2);

    // RED-0 is at trackPosition 12. Rolling 3 (to land on 15) or 5 (to pass over 15 to 17) must be blocked!
    game.tokens.RED[0] = {
      ...game.tokens.RED[0],
      status: "ACTIVE",
      stepsFromStart: 12,
      trackPosition: 12,
    };

    const landAttempt = rollDice(game, "RED", 3);
    expect(landAttempt.legalMoves).toHaveLength(0);
    expect(landAttempt.autoPassed).toBe(true);

    const passAttempt = rollDice(game, "RED", 5);
    expect(passAttempt.legalMoves).toHaveLength(0);
    expect(passAttempt.autoPassed).toBe(true);
  });

  it("11. Three consecutive sixes forfeits the third move and switches turn", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });

    // First 6 -> launch RED-0
    game = rollDice(game, "RED", 6).state;
    game = moveToken(game, "RED", 0).state;
    expect(game.consecutiveSixes).toBe(1);
    expect(game.currentPlayer).toBe("RED");

    // Second 6 -> launch RED-1
    game = rollDice(game, "RED", 6).state;
    game = moveToken(game, "RED", 1).state;
    expect(game.consecutiveSixes).toBe(2);
    expect(game.currentPlayer).toBe("RED");

    // Third consecutive 6 -> forfeited & switches to YELLOW!
    const thirdSix = rollDice(game, "RED", 6);
    expect(thirdSix.tripleSixForfeited).toBe(true);
    expect(thirdSix.state.currentPlayer).toBe("YELLOW");
    expect(thirdSix.state.consecutiveSixes).toBe(0);
  });

  it("13. Rolling 6 when no legal moves exist still grants another roll (unless 3rd consecutive 6)", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });
    // Put all 4 RED tokens at step 55 (need exact 1 to finish), so a roll of 6 has 0 legal moves
    for (let i = 0; i < 4; i++) {
      game.tokens.RED[i] = {
        ...game.tokens.RED[i],
        status: "HOME_PATH",
        stepsFromStart: 55,
        trackPosition: null,
        homePathPosition: 5,
      };
    }

    const res = rollDice(game, "RED", 6);
    expect(res.legalMoves).toHaveLength(0);
    expect(res.autoPassed).toBe(false);
    expect(res.state.currentPlayer).toBe("RED");
  });

  it("14 & 15. Rejects invalid actions and detects 4-token Victory immediately", () => {
    let game = initializeGame({ players: ["RED", "YELLOW"] });

    // Wrong player trying to roll
    const wrongRoll = rollDice(game, "YELLOW", 5);
    expect(wrongRoll.error).toBeDefined();

    // Put 3 RED tokens in FINISHED (56) and 4th RED token at 54
    for (let i = 0; i < 3; i++) {
      game.tokens.RED[i] = {
        ...game.tokens.RED[i],
        status: "FINISHED",
        stepsFromStart: FINAL_HOME_STEP,
        trackPosition: null,
        homePathPosition: 6,
      };
    }
    game.tokens.RED[3] = {
      ...game.tokens.RED[3],
      status: "HOME_PATH",
      stepsFromStart: 54,
      trackPosition: null,
      homePathPosition: 4,
    };

    // Roll exact 2 -> RED-3 finishes -> RED wins!
    game = rollDice(game, "RED", 2).state;
    const winRes = moveToken(game, "RED", 3);
    expect(winRes.winner).toBe("RED");
    expect(winRes.state.matchStatus).toBe("COMPLETED");
    expect(checkWinningCondition(winRes.state, "RED")).toBe(true);

    // Reject further rolls after match completion
    const postWinRoll = rollDice(winRes.state, "RED", 6);
    expect(postWinRoll.error).toBeDefined();
  });
});

