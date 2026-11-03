/**
 * Oware rules engine + AI. Pure TypeScript with no React, DOM or Deno APIs, so
 * the SAME code runs in the browser (animation, local play) and in the
 * challenge-arena edge function (server-checked matches: the server replays
 * every move and plays the AI itself, so a result can't be faked).
 *
 * Imported by src/components/games/OwareGameBoard.tsx via a relative path.
 */

export type OwareRuleVariant = "nam-nam" | "abapa";
export type OwareSide = "creator" | "opponent";

export const PITS_PER_PLAYER = 6;
export const TOTAL_PIT_COUNT = PITS_PER_PLAYER * 2;
export const SEEDS_NEEDED_TO_WIN = 25;
const MAXIMUM_RELAY_SEGMENTS = 200;

export interface OwareAnimationStep {
  type?: "pickup" | "drop" | "capture";
  pits: number[];
  scores: { creator: number; opponent: number };
  activePit: number;
  inHand: number;
  eventText?: string;
  harvestedPit?: number;
  harvestedBy?: "creator" | "opponent";
  isRelayScoop?: boolean;
  lastSownPit?: number | null;
  capturedPits?: number[];
}

export interface OwareState {
  pits: number[]; // indices 0..5 = Creator (South, L->R), indices 6..11 = Opponent (North, R->L counter-clockwise)
  scores: { creator: number; opponent: number };
  turn: "creator" | "opponent";
  variant?: OwareRuleVariant;
  lastMove?: {
    pit: number;
    captured: number;
    player: "creator" | "opponent";
    laps?: number;
    summary?: string;
  } | null;
  winner?: "creator" | "opponent" | "draw" | null;
  moveCount: number;
}

export const INITIAL_OWARE_STATE: OwareState = {
  pits: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  scores: { creator: 0, opponent: 0 },
  turn: "creator",
  variant: "nam-nam", // Default to traditional Ghanaian Nam-Nam (Relay & 4-Seed Harvest)
  lastMove: null,
  winner: null,
  moveCount: 0,
};

export function sumSeedsOnSide(pits: number[], side: "creator" | "opponent"): number {
  const start = side === "creator" ? 0 : PITS_PER_PLAYER;
  return pits.slice(start, start + PITS_PER_PLAYER).reduce((total, seeds) => total + seeds, 0);
}

/**
 * 1. GHANAIAN OWARE NAM-NAM / RELAY ENGINE (Continuous Relay Sowing, 12+ Skip-Origin,
 *    4-Seed Harvest & Mandatory Feeding Rule)
 */
export function simulateNamNamMoveWithSteps(
  state: OwareState,
  startPit: number,
  player: "creator" | "opponent",
  recordSteps = false,
  skipFeedingValidation = false
): { nextState: OwareState; steps: OwareAnimationStep[] } | null {
  if (state.winner) return null;
  if (player === "creator" && (startPit < 0 || startPit > 5)) return null;
  if (player === "opponent" && (startPit < 6 || startPit > 11)) return null;
  if (!state.pits[startPit] || state.pits[startPit] <= 0) return null;

  const opponent: "creator" | "opponent" = player === "creator" ? "opponent" : "creator";

  // Mandatory Feeding Rule: if opponent has 0 seeds, player must play a move that gives them seeds (if any exists)
  if (!skipFeedingValidation && sumSeedsOnSide(state.pits, opponent) === 0) {
    const myStart = player === "creator" ? 0 : 6;
    const myEnd = player === "creator" ? 5 : 11;
    let canAnyMoveFeed = false;
    for (let p = myStart; p <= myEnd; p++) {
      if (state.pits[p] <= 0) continue;
      const candidate = simulateNamNamMoveWithSteps(state, p, player, false, true);
      if (candidate && sumSeedsOnSide(candidate.nextState.pits, opponent) > 0) {
        canAnyMoveFeed = true;
        break;
      }
    }
    if (canAnyMoveFeed) {
      const thisCandidate = simulateNamNamMoveWithSteps(state, startPit, player, false, true);
      if (!thisCandidate || sumSeedsOnSide(thisCandidate.nextState.pits, opponent) === 0) {
        return null;
      }
    }
  }

  const pits = [...state.pits];
  const scores = { ...state.scores };
  const steps: OwareAnimationStep[] = [];

  let segmentOriginPitIndex = startPit;
  let currentPit = startPit;
  let laps = 0;
  const scoreBefore = scores[player];

  for (let segment = 0; segment < MAXIMUM_RELAY_SEGMENTS; segment++) {
    let inHand = pits[segmentOriginPitIndex];
    if (inHand <= 0) break;
    laps += 1;
    pits[segmentOriginPitIndex] = 0;
    currentPit = segmentOriginPitIndex;

    if (recordSteps) {
      steps.push({
        type: "pickup",
        pits: [...pits],
        scores: { ...scores },
        activePit: segmentOriginPitIndex,
        inHand,
        isRelayScoop: segment > 0,
        lastSownPit: segment > 0 ? segmentOriginPitIndex : null,
        eventText:
          segment === 0
            ? `Scooped ${inHand} seeds from Bowl #${segmentOriginPitIndex + 1}`
            : `🔄 NAM-NAM RELAY! Scooped ${inHand} seeds from Bowl #${segmentOriginPitIndex + 1} (Lap #${laps})`,
      });
    }

    let endedByLastSeedCapture = false;

    while (inHand > 0) {
      currentPit = (currentPit + 1) % TOTAL_PIT_COUNT;
      // A pit with 12 or more seeds skips its own origin pit on that segment
      if (currentPit === segmentOriginPitIndex) continue;

      pits[currentPit] += 1;
      inHand -= 1;

      const isLastSeedInHand = inHand === 0;

      if (recordSteps) {
        steps.push({
          type: "drop",
          pits: [...pits],
          scores: { ...scores },
          activePit: currentPit,
          inHand,
          lastSownPit: currentPit,
        });
      }

      // Check 4-Seed Harvest Rule
      if (pits[currentPit] === 4) {
        const capturedCount = pits[currentPit];
        pits[currentPit] = 0;
        const harvester: "creator" | "opponent" = isLastSeedInHand
          ? player
          : currentPit <= 5
          ? "creator"
          : "opponent";

        scores[harvester] += capturedCount;

        // Final 8 seeds sweep rule: if <= 4 seeds remain on the entire board when hand is empty, harvester sweeps them
        const totalRemainingOnBoard = pits.reduce((a, b) => a + b, 0) + inHand;
        if (totalRemainingOnBoard === 4 && inHand === 0) {
          for (let i = 0; i < TOTAL_PIT_COUNT; i++) pits[i] = 0;
          scores[harvester] += 4;
        }

        if (recordSteps) {
          steps.push({
            type: "capture",
            pits: [...pits],
            scores: { ...scores },
            activePit: currentPit,
            inHand,
            harvestedPit: currentPit,
            harvestedBy: harvester,
            lastSownPit: currentPit,
            capturedPits: [currentPit],
            eventText: isLastSeedInHand
              ? `🔥 Final seed made 4 in Bowl #${currentPit + 1}! +4 harvested!`
              : `✨ Bowl #${currentPit + 1} reached 4 seeds! +4 harvested!`,
          });
        }

        if (isLastSeedInHand) {
          endedByLastSeedCapture = true;
          break;
        }
      }
    }

    if (endedByLastSeedCapture) break;
    const landedInEmptyPit = pits[currentPit] === 1;
    if (landedInEmptyPit) break;
    segmentOriginPitIndex = currentPit;
  }

  const nextTurn: "creator" | "opponent" = opponent;
  const nextTurnSeeds = sumSeedsOnSide(pits, nextTurn);
  const currentTurnSeeds = sumSeedsOnSide(pits, player);

  let finalTurn: "creator" | "opponent" = nextTurn;
  if (nextTurnSeeds === 0 && currentTurnSeeds > 0) {
    const myStart = player === "creator" ? 0 : 6;
    const myEnd = player === "creator" ? 5 : 11;
    const canFeed = pits
      .slice(myStart, myEnd + 1)
      .some((count, idx) => count + idx >= PITS_PER_PLAYER);
    if (canFeed) {
      finalTurn = player;
    } else {
      scores.creator += sumSeedsOnSide(pits, "creator");
      scores.opponent += sumSeedsOnSide(pits, "opponent");
      for (let i = 0; i < TOTAL_PIT_COUNT; i++) pits[i] = 0;
    }
  } else if (nextTurnSeeds === 0 && currentTurnSeeds === 0) {
    for (let i = 0; i < TOTAL_PIT_COUNT; i++) pits[i] = 0;
  }

  const gained = scores[player] - scoreBefore;
  const totalBoardSeeds = pits.reduce((acc, v) => acc + v, 0);

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;
  const boardEmpty = totalBoardSeeds === 0;

  if (scores.creator >= SEEDS_NEEDED_TO_WIN) winner = "creator";
  else if (scores.opponent >= SEEDS_NEEDED_TO_WIN) winner = "opponent";
  else if (
    boardEmpty ||
    totalMoveCount >= 100 ||
    (totalBoardSeeds <= 4 && gained === 0 && (scores.creator >= 20 || scores.opponent >= 20))
  ) {
    scores.creator += sumSeedsOnSide(pits, "creator");
    scores.opponent += sumSeedsOnSide(pits, "opponent");
    for (let i = 0; i < TOTAL_PIT_COUNT; i++) pits[i] = 0;
    if (scores.creator > scores.opponent) winner = "creator";
    else if (scores.opponent > scores.creator) winner = "opponent";
    else winner = "draw";
  }

  return {
    nextState: {
      pits,
      scores,
      turn: finalTurn,
      variant: "nam-nam",
      lastMove: {
        pit: startPit,
        captured: gained,
        player,
        laps,
        summary:
          gained > 0
            ? `🔥 Harvested +${gained} seeds across ${laps} relay lap${laps > 1 ? "s" : ""}!`
            : `Sowed Bowl #${startPit + 1} (${laps} lap${laps > 1 ? "s" : ""})`,
      },
      winner,
      moveCount: totalMoveCount,
    },
    steps,
  };
}

/**
 * 2. OFFICIAL OWARE ABAPA ENGINE (Single-Lap Sowing, 12+ Skip, 2/3 Backward Chain Capture,
 *    Grand Slam Protection, and Mandatory Feeding Golden Rule)
 */
export function simulateAbapaMoveWithSteps(
  state: OwareState,
  pitIndex: number,
  player: "creator" | "opponent",
  recordSteps = false,
  skipFeedingValidation = false
): { nextState: OwareState; steps: OwareAnimationStep[] } | null {
  if (state.winner) return null;
  if (player === "creator" && (pitIndex < 0 || pitIndex > 5)) return null;
  if (player === "opponent" && (pitIndex < 6 || pitIndex > 11)) return null;

  const seedsToSow = state.pits[pitIndex];
  if (!seedsToSow || seedsToSow <= 0) return null;

  // Enforce Mandatory Feeding Rule ("Let the Opponent Play"):
  // If opponent currently has 0 seeds, player MUST play a move that feeds them if any such move exists
  const oppStart = player === "creator" ? 6 : 0;
  const oppEnd = player === "creator" ? 11 : 5;
  const oppCurrentSeeds = state.pits.slice(oppStart, oppEnd + 1).reduce((a, b) => a + b, 0);

  if (!skipFeedingValidation && oppCurrentSeeds === 0) {
    const myStart = player === "creator" ? 0 : 6;
    const myEnd = player === "creator" ? 5 : 11;
    let anyMoveFeedsOpponent = false;
    for (let i = myStart; i <= myEnd; i++) {
      if (state.pits[i] <= 0) continue;
      const test = simulateAbapaMoveWithSteps(state, i, player, false, true);
      if (test) {
        const oppAfter = test.nextState.pits
          .slice(oppStart, oppEnd + 1)
          .reduce((a, b) => a + b, 0);
        if (oppAfter > 0) {
          anyMoveFeedsOpponent = true;
          break;
        }
      }
    }
    if (anyMoveFeedsOpponent) {
      const thisTest = simulateAbapaMoveWithSteps(state, pitIndex, player, false, true);
      const oppAfterThis = thisTest
        ? thisTest.nextState.pits.slice(oppStart, oppEnd + 1).reduce((a, b) => a + b, 0)
        : 0;
      if (oppAfterThis === 0) {
        return null; // Illegal under Abapa Mandatory Feeding rule!
      }
    }
  }

  const nextPits = [...state.pits];
  const steps: OwareAnimationStep[] = [];
  nextPits[pitIndex] = 0;

  let currentPit = pitIndex;
  let remaining = seedsToSow;

  if (recordSteps) {
    steps.push({
      type: "pickup",
      pits: [...nextPits],
      scores: { ...state.scores },
      activePit: pitIndex,
      inHand: remaining,
      lastSownPit: null,
      eventText: `Scooped ${remaining} seeds from Bowl #${pitIndex + 1}`,
    });
  }

  while (remaining > 0) {
    currentPit = (currentPit + 1) % 12;
    // Abapa 12+ Kulo rule: always skip the starting bowl
    if (currentPit === pitIndex) continue;
    nextPits[currentPit] += 1;
    remaining -= 1;

    if (recordSteps) {
      steps.push({
        type: "drop",
        pits: [...nextPits],
        scores: { ...state.scores },
        activePit: currentPit,
        inHand: remaining,
        lastSownPit: currentPit,
      });
    }
  }

  // Check capture in opponent's row (2 or 3 seeds)
  const isOpponentTerritory = (idx: number) =>
    player === "creator" ? idx >= 6 && idx <= 11 : idx >= 0 && idx <= 5;

  let captured = 0;
  const tempPits = [...nextPits];
  let captureCursor = currentPit;
  const capturedIndices: number[] = [];

  while (
    isOpponentTerritory(captureCursor) &&
    (tempPits[captureCursor] === 2 || tempPits[captureCursor] === 3)
  ) {
    captured += tempPits[captureCursor];
    capturedIndices.push(captureCursor);
    tempPits[captureCursor] = 0;
    captureCursor = (captureCursor + 11) % 12;
  }

  // Grand Slam rule: if capturing would leave opponent with 0 seeds, capture is forfeited
  const oppRemainingAfterCapture = tempPits
    .slice(oppStart, oppEnd + 1)
    .reduce((acc, v) => acc + v, 0);

  let finalPits = nextPits;
  if (captured > 0 && oppRemainingAfterCapture > 0) {
    finalPits = tempPits;
  } else if (captured > 0 && oppRemainingAfterCapture === 0) {
    captured = 0;
    capturedIndices.length = 0;
  }

  const nextScores = {
    creator: state.scores.creator + (player === "creator" ? captured : 0),
    opponent: state.scores.opponent + (player === "opponent" ? captured : 0),
  };

  if (recordSteps && captured > 0) {
    for (const capIdx of capturedIndices) {
      steps.push({
        type: "capture",
        pits: [...finalPits],
        scores: { ...nextScores },
        activePit: capIdx,
        inHand: captured,
        harvestedPit: capIdx,
        harvestedBy: player,
        lastSownPit: currentPit,
        capturedPits: capturedIndices,
        eventText: `🔥 Abapa Capture! Harvested +${captured} seeds!`,
      });
    }
  }

  const nextTurn: "creator" | "opponent" = player === "creator" ? "opponent" : "creator";
  const nextTurnStart = nextTurn === "creator" ? 0 : 6;
  const nextTurnEnd = nextTurn === "creator" ? 5 : 11;
  const nextTurnSeeds = finalPits
    .slice(nextTurnStart, nextTurnEnd + 1)
    .reduce((a, b) => a + b, 0);

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;

  if (nextScores.creator >= SEEDS_NEEDED_TO_WIN) {
    winner = "creator";
  } else if (nextScores.opponent >= SEEDS_NEEDED_TO_WIN) {
    winner = "opponent";
  } else if (nextTurnSeeds === 0 || totalMoveCount >= 80) {
    const remCreator = finalPits.slice(0, 6).reduce((a, b) => a + b, 0);
    const remOpponent = finalPits.slice(6, 12).reduce((a, b) => a + b, 0);
    nextScores.creator += remCreator;
    nextScores.opponent += remOpponent;
    for (let i = 0; i < 12; i++) finalPits[i] = 0;

    if (nextScores.creator > nextScores.opponent) winner = "creator";
    else if (nextScores.opponent > nextScores.creator) winner = "opponent";
    else winner = "draw";
  }

  return {
    nextState: {
      pits: finalPits,
      scores: nextScores,
      turn: nextTurn,
      variant: "abapa",
      lastMove: {
        pit: pitIndex,
        captured,
        player,
        laps: 1,
        summary:
          captured > 0
            ? `🔥 Captured +${captured} seeds!`
            : `Sowed Bowl #${pitIndex + 1}`,
      },
      winner,
      moveCount: totalMoveCount,
    },
    steps,
  };
}

/** Unified move simulator (used by AI and validation) */
export function simulateOwareMove(
  state: OwareState,
  pitIndex: number,
  player: "creator" | "opponent"
): OwareState | null {
  const variant = state.variant || "nam-nam";
  const res =
    variant === "nam-nam"
      ? simulateNamNamMoveWithSteps(state, pitIndex, player, false)
      : simulateAbapaMoveWithSteps(state, pitIndex, player, false);
  return res ? res.nextState : null;
}

/** Returns all legal pit indices for the given player, enforcing Mandatory Feeding when opponent has 0 seeds */
export function getLegalOwareMoves(
  state: OwareState,
  player: "creator" | "opponent" = state.turn
): number[] {
  if (state.winner) return [];
  const firstOwnPit = player === "creator" ? 0 : PITS_PER_PLAYER;
  const legalPits: number[] = [];
  for (let pitIndex = firstOwnPit; pitIndex < firstOwnPit + PITS_PER_PLAYER; pitIndex++) {
    if (state.pits[pitIndex] > 0 && simulateOwareMove(state, pitIndex, player)) {
      legalPits.push(pitIndex);
    }
  }
  return legalPits;
}


/* ─────────────────────────────────── AI ─────────────────────────────────── */

export type OwareDifficulty = "easy" | "medium" | "hard" | "master";

export const OWARE_DIFFICULTY_PROFILES: Record<
  OwareDifficulty,
  { label: string; timeMs: number; maxDepth: number; blunderRate: number; noise: number }
> = {
  // Easy: shallow look-ahead and frequent "human" slips.
  easy: { label: "Easy", timeMs: 60, maxDepth: 2, blunderRate: 0.3, noise: 90 },
  medium: { label: "Medium", timeMs: 180, maxDepth: 4, blunderRate: 0.08, noise: 30 },
  hard: { label: "Hard", timeMs: 450, maxDepth: 9, blunderRate: 0, noise: 6 },
  // Grandmaster: deepest search the time budget allows, no deliberate errors.
  master: { label: "Grandmaster", timeMs: 900, maxDepth: 16, blunderRate: 0, noise: 0 },
};

const WIN_SCORE = 1_000_000;

function otherSide(side: OwareSide): OwareSide {
  return side === "creator" ? "opponent" : "creator";
}

function sideRange(side: OwareSide): [number, number] {
  return side === "creator" ? [0, PITS_PER_PLAYER] : [PITS_PER_PLAYER, TOTAL_PIT_COUNT];
}

/** Static evaluation from `aiSide`'s point of view (positive = good for the AI). */
export function evaluateOwarePosition(state: OwareState, aiSide: OwareSide = "opponent"): number {
  const human = otherSide(aiSide);
  if (state.winner === aiSide) return WIN_SCORE;
  if (state.winner === human) return -WIN_SCORE;
  if (state.winner === "draw") return 0;

  const variant = state.variant || "nam-nam";
  const myScore = state.scores[aiSide];
  const theirScore = state.scores[human];
  let score = (myScore - theirScore) * 64;

  // Getting close to 25 matters more than raw difference near the end.
  if (myScore >= 20) score += (myScore - 19) * 18;
  if (theirScore >= 20) score -= (theirScore - 19) * 18;

  const [aStart, aEnd] = sideRange(aiSide);
  const [hStart, hEnd] = sideRange(human);
  let mySeeds = 0;
  let theirSeeds = 0;
  let myRisk = 0;
  let theirRisk = 0;
  let myKulo = 0;
  let myMobility = 0;
  let theirMobility = 0;

  for (let i = aStart; i < aEnd; i++) {
    const s = state.pits[i];
    mySeeds += s;
    if (s > 0) myMobility++;
    if (variant === "nam-nam" ? s === 3 : s === 1 || s === 2) myRisk++;
    if (variant === "abapa" && s >= 12) myKulo++;
  }
  for (let i = hStart; i < hEnd; i++) {
    const s = state.pits[i];
    theirSeeds += s;
    if (s > 0) theirMobility++;
    if (variant === "nam-nam" ? s === 3 : s === 1 || s === 2) theirRisk++;
  }

  // Seeds left on a side are swept to that side when the board runs dry.
  score += (mySeeds - theirSeeds) * 4;
  score -= myRisk * 30;
  score += theirRisk * 24;
  score += myKulo * 40;
  score += (myMobility - theirMobility) * 6;
  // Being starved of moves late in the game is close to losing.
  if (myMobility === 0) score -= 400;
  if (theirMobility === 0) score += 250;
  return score;
}

class SearchTimeout extends Error {}

interface SearchContext {
  aiSide: OwareSide;
  deadline: number;
  nodes: number;
  table: Map<string, { depth: number; value: number }>;
}

function positionKey(state: OwareState): string {
  return `${state.pits.join(",")}|${state.scores.creator},${state.scores.opponent}|${state.turn}|${state.variant || "nam-nam"}`;
}

/** Legal children of `state` for the side to move, best-looking first (cheap ordering = faster cutoffs). */
function orderedChildren(state: OwareState, aiSide: OwareSide): { pit: number; next: OwareState; quick: number }[] {
  const mover = state.turn;
  const [start, end] = sideRange(mover);
  const children: { pit: number; next: OwareState; quick: number }[] = [];
  for (let pit = start; pit < end; pit++) {
    if (state.pits[pit] <= 0) continue;
    const next = simulateOwareMove(state, pit, mover);
    if (!next) continue;
    const quick = evaluateOwarePosition(next, aiSide);
    children.push({ pit, next, quick });
  }
  const maximizing = mover === aiSide;
  children.sort((a, b) => (maximizing ? b.quick - a.quick : a.quick - b.quick));
  return children;
}

function search(state: OwareState, depth: number, alpha: number, beta: number, ctx: SearchContext, ply: number): number {
  if ((++ctx.nodes & 127) === 0 && Date.now() > ctx.deadline) throw new SearchTimeout();

  if (state.winner) {
    const v = evaluateOwarePosition(state, ctx.aiSide);
    // Prefer quicker wins and slower losses.
    return v > 0 ? v - ply : v < 0 ? v + ply : 0;
  }
  if (depth === 0) return evaluateOwarePosition(state, ctx.aiSide);

  const key = positionKey(state);
  const cached = ctx.table.get(key);
  if (cached && cached.depth >= depth) return cached.value;

  const children = orderedChildren(state, ctx.aiSide);
  if (children.length === 0) return evaluateOwarePosition(state, ctx.aiSide);

  const maximizing = state.turn === ctx.aiSide;
  const alpha0 = alpha;
  const beta0 = beta;
  let best = maximizing ? -Infinity : Infinity;
  for (const child of children) {
    const v = search(child.next, depth - 1, alpha, beta, ctx, ply + 1);
    if (maximizing) {
      if (v > best) best = v;
      if (v > alpha) alpha = v;
    } else {
      if (v < best) best = v;
      if (v < beta) beta = v;
    }
    if (beta <= alpha) break;
  }
  // Only exact values (strictly inside the original window) are safe to reuse.
  if (best > alpha0 && best < beta0) ctx.table.set(key, { depth, value: best });
  return best;
}

function gaussian(sigma: number): number {
  if (sigma <= 0) return 0;
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

/**
 * Pick the AI's pit. Iterative deepening inside a time budget, so it stays
 * responsive on slow phones and on the edge function's CPU limit.
 * Returns -1 when the AI has no legal move.
 */
export function chooseOwareAiMove(
  state: OwareState,
  opts: { difficulty?: OwareDifficulty; aiSide?: OwareSide; timeMs?: number } = {}
): number {
  const aiSide = opts.aiSide ?? "opponent";
  const profile = OWARE_DIFFICULTY_PROFILES[opts.difficulty ?? "medium"];
  const root: OwareState = state.turn === aiSide ? state : { ...state, turn: aiSide };
  const moves = orderedChildren(root, aiSide);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0].pit;

  if (profile.blunderRate > 0 && Math.random() < profile.blunderRate) {
    return moves[Math.floor(Math.random() * moves.length)].pit;
  }

  const ctx: SearchContext = {
    aiSide,
    deadline: Date.now() + (opts.timeMs ?? profile.timeMs),
    nodes: 0,
    table: new Map(),
  };

  let bestPit = moves[0].pit;
  let scored: { pit: number; value: number }[] = moves.map((m) => ({ pit: m.pit, value: m.quick }));
  for (let depth = 1; depth <= profile.maxDepth; depth++) {
    try {
      const results: { pit: number; value: number }[] = [];
      let alpha = -Infinity;
      for (const m of scored.map((s) => moves.find((x) => x.pit === s.pit)!)) {
        const v = search(m.next, depth - 1, alpha, Infinity, ctx, 1);
        results.push({ pit: m.pit, value: v });
        if (v > alpha) alpha = v;
      }
      results.sort((a, b) => b.value - a.value);
      scored = results;
      bestPit = results[0].pit;
      if (Math.abs(results[0].value) >= WIN_SCORE - 100) break; // forced result found
    } catch (e) {
      if (e instanceof SearchTimeout) break;
      throw e;
    }
  }

  if (profile.noise > 0) {
    const noisy = scored.map((s) => ({ pit: s.pit, value: s.value + gaussian(profile.noise) }));
    noisy.sort((a, b) => b.value - a.value);
    return noisy[0].pit;
  }
  return bestPit;
}

/** Map the old numeric depth selector (2/4/6) and player level onto a difficulty. */
export function difficultyFromDepth(depth?: number): OwareDifficulty {
  if (!depth) return "medium";
  if (depth <= 2) return "easy";
  if (depth <= 4) return "medium";
  if (depth <= 6) return "hard";
  return "master";
}

/**
 * If the side to move has no legal move, the game ends: each side keeps the
 * seeds on its own row. Returns the settled state, or the same state when a
 * move is available. Shared by the board UI and the server so both end games
 * identically.
 */
export function settleIfNoLegalMoves(state: OwareState): OwareState {
  if (state.winner || (state.moveCount || 0) === 0) return state;
  if (getLegalOwareMoves(state, state.turn).length > 0) return state;
  const finalCreator = state.scores.creator + sumSeedsOnSide(state.pits, "creator");
  const finalOpponent = state.scores.opponent + sumSeedsOnSide(state.pits, "opponent");
  return {
    ...state,
    pits: Array(TOTAL_PIT_COUNT).fill(0),
    scores: { creator: finalCreator, opponent: finalOpponent },
    winner: finalCreator > finalOpponent ? "creator" : finalOpponent > finalCreator ? "opponent" : "draw",
  };
}

/** Structural check for a board coming from storage or a client. */
export function isValidOwareState(value: unknown): value is OwareState {
  const s = value as OwareState;
  return (
    !!s &&
    Array.isArray(s.pits) &&
    s.pits.length === TOTAL_PIT_COUNT &&
    s.pits.every((n) => Number.isInteger(n) && n >= 0) &&
    !!s.scores &&
    Number.isInteger(s.scores.creator) &&
    Number.isInteger(s.scores.opponent) &&
    (s.turn === "creator" || s.turn === "opponent") &&
    s.pits.reduce((a, b) => a + b, 0) + s.scores.creator + s.scores.opponent === 48
  );
}
