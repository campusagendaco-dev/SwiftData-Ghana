import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, HelpCircle, Sparkles, Flame, Smartphone, Brain } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";
import {
  playWoodSeedClack,
  playLevelUpFanfare,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  HUMAN_CHALLENGER_PERSONAS,
  sampleGaussianError,
} from "@/lib/game-sensory-engine";

export type OwareRuleVariant = "nam-nam" | "abapa";

const PITS_PER_PLAYER = 6;
const TOTAL_PIT_COUNT = PITS_PER_PLAYER * 2;
const SEEDS_NEEDED_TO_WIN = 25;
const MAXIMUM_RELAY_SEGMENTS = 200;
const HAND_MOVE_DURATION_MS = 220;
const HAND_DROP_PAUSE_MS = 85;
const HAND_MAXIMUM_SEEDS_DRAWN = 12;
const MAXIMUM_SEEDS_DRAWN_PER_PIT = 28;

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

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;
  const boardEmpty = pits.every((p) => p === 0);

  if (scores.creator >= SEEDS_NEEDED_TO_WIN) winner = "creator";
  else if (scores.opponent >= SEEDS_NEEDED_TO_WIN) winner = "opponent";
  else if (boardEmpty || totalMoveCount >= 100) {
    scores.creator += sumSeedsOnSide(pits, "creator");
    scores.opponent += sumSeedsOnSide(pits, "opponent");
    for (let i = 0; i < TOTAL_PIT_COUNT; i++) pits[i] = 0;
    if (scores.creator > scores.opponent) winner = "creator";
    else if (scores.opponent > scores.creator) winner = "opponent";
    else winner = "draw";
  }

  const gained = scores[player] - scoreBefore;

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

/** Heuristic evaluation for Grandmaster Oware Alpha-Beta Minimax (supports both Nam-Nam & Abapa) */
function evaluateOwareBoard(state: OwareState): number {
  if (state.winner === "opponent") return 100000;
  if (state.winner === "creator") return -100000;
  if (state.winner === "draw") return 0;

  const variant = state.variant || "nam-nam";
  let score = (state.scores.opponent - state.scores.creator) * 52;

  let aiSeeds = 0;
  let humanSeeds = 0;
  let aiVulnerablePits = 0;
  let humanVulnerablePits = 0;
  let aiKuloBonus = 0;

  for (let i = 6; i <= 11; i++) {
    const s = state.pits[i];
    aiSeeds += s;
    if (variant === "nam-nam") {
      if (s === 3) aiVulnerablePits += 1;
    } else {
      if (s === 1 || s === 2) aiVulnerablePits += 1;
      if (s >= 8) aiKuloBonus += 14;
    }
  }

  for (let i = 0; i <= 5; i++) {
    const s = state.pits[i];
    humanSeeds += s;
    if (variant === "nam-nam") {
      if (s === 3) humanVulnerablePits += 1;
    } else {
      if (s === 1 || s === 2) humanVulnerablePits += 1;
    }
  }

  score += (aiSeeds - humanSeeds) * 3;
  score -= aiVulnerablePits * 32;
  score += humanVulnerablePits * 24;
  score += aiKuloBonus;

  return score;
}

function minimaxOware(
  state: OwareState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean
): number {
  const activePlayer = maximizing ? "opponent" : "creator";
  const legalMoves = getLegalOwareMoves(state, activePlayer);

  if (depth === 0 || state.winner || legalMoves.length === 0) {
    return evaluateOwareBoard(state);
  }

  if (maximizing) {
    let maxEval = -Infinity;
    for (const i of legalMoves) {
      const next = simulateOwareMove(state, i, "opponent");
      if (!next) continue;
      const nextIsMax = next.turn === "opponent";
      const val = minimaxOware(next, depth - 1, alpha, beta, nextIsMax);
      if (val > maxEval) maxEval = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const i of legalMoves) {
      const next = simulateOwareMove(state, i, "creator");
      if (!next) continue;
      const nextIsMax = next.turn === "opponent";
      const val = minimaxOware(next, depth - 1, alpha, beta, nextIsMax);
      if (val < minEval) minEval = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

/**
 * Choose best Oware move using Alpha-Beta Minimax with tie-breaking among equal-value best moves
 * and configurable search depth (`2` = Easy, `4` = Medium, `6` = Hard).
 */
function pickBestAiMove(state: OwareState, playerLevel = 1, customDepth?: number): number {
  const validPits = getLegalOwareMoves(state, "opponent");
  if (validPits.length === 0) return -1;

  const searchDepth = customDepth ?? (playerLevel >= 5 ? 4 : 3);
  const noiseSigma = customDepth === 6 ? 4 : Math.max(12, 34 - playerLevel * 3);

  let bestValue = -Infinity;
  let bestMoves: number[] = [];

  for (const pit of validPits) {
    const sim1 = simulateOwareMove(state, pit, "opponent");
    if (!sim1) continue;
    const rawScore = minimaxOware(
      sim1,
      Math.max(1, searchDepth - 1),
      -Infinity,
      Infinity,
      sim1.turn === "opponent"
    );
    const evaluatedScore = Math.round((rawScore + sampleGaussianError(noiseSigma)) / 4) * 4;
    if (evaluatedScore > bestValue) {
      bestValue = evaluatedScore;
      bestMoves = [pit];
    } else if (evaluatedScore === bestValue) {
      bestMoves.push(pit);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? validPits[0];
}

/**
 * Authentic Olive-Green, Amber & Sage-Grey Nickernut Seed Pebbles
 * Arranged in a Fibonacci Golden-Angle Spiral (`goldenAngle = idx * 2.39996 + pitSeedOffset`)
 * up to `MAXIMUM_SEEDS_DRAWN_PER_PIT = 28`!
 */
const SEED_PALETTES = [
  "radial-gradient(circle at 32% 28%, #b8c470 0%, #8b9a46 58%, #546022 100%)", // Olive green
  "radial-gradient(circle at 32% 28%, #d2d1c5 0%, #a5a392 58%, #696759 100%)", // Sage pebble grey
  "radial-gradient(circle at 32% 28%, #f4e3b5 0%, #e0a84b 58%, #8f5c16 100%)", // Warm golden seed
  "radial-gradient(circle at 32% 28%, #aebc62 0%, #7d8c38 58%, #4a551c 100%)", // Deep olive
  "radial-gradient(circle at 32% 28%, #c5c8a8 0%, #969b74 58%, #5e6342 100%)", // Moss grey-green
  "radial-gradient(circle at 32% 28%, #dcdad0 0%, #b2afa0 58%, #757264 100%)", // Warm stone grey
];

function NickernutSeedCluster({
  count,
  pitSeedOffset,
  maxDrawn = MAXIMUM_SEEDS_DRAWN_PER_PIT,
  seedSizeClass = "w-3.5 h-3 sm:w-4 sm:h-3.5",
}: {
  count: number;
  pitSeedOffset: number;
  maxDrawn?: number;
  seedSizeClass?: string;
}) {
  const visibleCount = Math.min(count, maxDrawn);
  return (
    <div className="relative w-full h-full pointer-events-none">
      {Array.from({ length: visibleCount }).map((_, idx) => {
        const goldenAngle = idx * 2.39996 + pitSeedOffset;
        const distanceFromCentre =
          visibleCount === 1
            ? 0
            : Math.sqrt((idx + 0.5) / Math.max(8, Math.min(visibleCount + 2, maxDrawn))) * 34;
        const leftPercent = 50 + Math.cos(goldenAngle) * distanceFromCentre;
        const topPercent = 50 + Math.sin(goldenAngle) * distanceFromCentre;
        const rotDeg = Math.round(((goldenAngle * 180) / Math.PI) % 360);
        const bg = SEED_PALETTES[(pitSeedOffset + idx) % SEED_PALETTES.length];
        return (
          <span
            key={idx}
            className={`absolute ${seedSizeClass} -translate-x-1/2 -translate-y-1/2 rounded-[52%_48%_48%_52%] shadow-[0_3px_5px_rgba(0,0,0,0.75),inset_0_1px_2px_rgba(255,255,255,0.45)] border border-black/30 transition-all duration-150`}
            style={{
              left: `${leftPercent.toFixed(1)}%`,
              top: `${topPercent.toFixed(1)}%`,
              background: bg,
              transform: `translate(-50%, -50%) rotate(${rotDeg}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Animated SVG Sowing Hand that glides from bowl to bowl scooping & dropping seeds
 * (Modeled after the reference Oware `<svg class="hand-svg" viewBox="0 0 100 140">` + `hand-seeds` + `hand-count`)
 */
function OwareAnimatedHand({
  visible,
  x,
  y,
  widthPx,
  isTopPlayer,
  isInstant,
  isPulsing,
  seedCount,
}: {
  visible: boolean;
  x: number;
  y: number;
  widthPx: number;
  isTopPlayer: boolean;
  isInstant: boolean;
  isPulsing: boolean;
  seedCount: number;
}) {
  const heightPx = widthPx * 1.4;
  const skinLight = isTopPlayer ? "#f0c08a" : "#d79a5b";
  const skinDark = isTopPlayer ? "#c58b52" : "#a8683a";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30"
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        left: `${x - widthPx / 2}px`,
        top: `${y - heightPx * 0.2}px`,
        opacity: visible ? 1 : 0,
        transformOrigin: "50% 20%",
        transform: isPulsing ? "scale(0.88)" : "scale(1)",
        transitionProperty: isInstant ? "none" : "left, top, opacity, transform",
        transitionDuration: isInstant ? "0ms" : `${HAND_MOVE_DURATION_MS}ms`,
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        filter: "drop-shadow(0 12px 10px rgba(0, 0, 0, 0.6))",
      }}
    >
      <svg
        viewBox="0 0 100 140"
        className="block w-full h-full overflow-visible"
        style={{
          transformOrigin: "50% 20%",
          transform: isTopPlayer ? "rotate(180deg)" : "none",
        }}
      >
        <defs>
          <linearGradient id={`oware-hand-skin-${isTopPlayer ? "top" : "bot"}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={skinLight} />
            <stop offset="100%" stopColor={skinDark} />
          </linearGradient>
        </defs>
        <g
          fill={`url(#oware-hand-skin-${isTopPlayer ? "top" : "bot"})`}
          stroke="rgba(60,30,10,0.6)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        >
          <rect x="29" y="118" width="42" height="90" rx="6" />
          <rect x="2" y="62" width="15" height="48" rx="7.5" transform="rotate(-28 9 100)" />
          <rect x="20" y="24" width="14" height="64" rx="7" />
          <rect x="35.5" y="10" width="14" height="78" rx="7" />
          <rect x="51" y="18" width="14" height="70" rx="7" />
          <rect x="66.5" y="36" width="13" height="52" rx="6.5" />
          <rect x="18" y="66" width="62" height="68" rx="26" />
        </g>
        <g fill="rgba(255,255,255,0.35)">
          <rect x="23" y="27" width="8" height="9" rx="3.5" />
          <rect x="38.5" y="13" width="8" height="9" rx="3.5" />
          <rect x="54" y="21" width="8" height="9" rx="3.5" />
          <rect x="69" y="39" width="7" height="8" rx="3" />
        </g>
        <path
          d="M30 100 Q50 112 70 100"
          fill="none"
          stroke="rgba(60,30,10,0.38)"
          strokeWidth="1.5"
        />
      </svg>

      {/* Seeds held in fingertips */}
      <div
        className="absolute"
        style={{
          left: "50%",
          top: "20%",
          width: "44%",
          aspectRatio: "1 / 1",
          transform: "translate(-50%, -50%)",
        }}
      >
        <NickernutSeedCluster
          count={Math.min(seedCount, HAND_MAXIMUM_SEEDS_DRAWN)}
          pitSeedOffset={3}
          maxDrawn={HAND_MAXIMUM_SEEDS_DRAWN}
          seedSizeClass="w-2.5 h-2.5"
        />
      </div>

      {/* Seed count badge next to fingertips */}
      {seedCount > 0 && (
        <span
          className="absolute px-2 py-0.5 rounded-full bg-slate-950/95 border border-amber-400/70 text-amber-300 font-black font-mono text-xs shadow-lg"
          style={{
            left: "88%",
            top: "20%",
            transform: "translateY(-50%)",
          }}
        >
          {seedCount}
        </span>
      )}
    </div>
  );
}

/**
 * Brushed Brass/Copper Folding Hinge between the two Black Ebony Board Halves (matches reference photo)
 */
function BrassHinge() {
  return (
    <div
      className="w-8 sm:w-10 h-6 sm:h-7 rounded-[3px] flex flex-col justify-between p-0.5 shadow-[0_2px_6px_rgba(0,0,0,0.85)] border border-amber-900/80 z-20"
      style={{
        background:
          "linear-gradient(135deg, #f6d38b 0%, #c88a3b 45%, #8f5616 75%, #e7b563 100%)",
      }}
    >
      <div className="flex items-center justify-between px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
      </div>
      <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-[#5a3209] via-[#f7d894] to-[#5a3209] border-y border-black/50" />
      <div className="flex items-center justify-between px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
      </div>
    </div>
  );
}

interface OwareGameBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: OwareState;
  onStateChange?: (nextState: OwareState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: OwareState) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
}

export function OwareGameBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
  onPointsEarned,
  playerLevel = 1,
}: OwareGameBoardProps) {
  const persona = HUMAN_CHALLENGER_PERSONAS.oware;
  const effectiveOpponentName =
    mode === "p2p"
      ? opponentName
      : opponentName && !opponentName.toLowerCase().includes("ai")
      ? opponentName
      : persona.name;

  const [game, setGame] = useState<OwareState>(() =>
    initialState && Array.isArray(initialState.pits) && initialState.pits.length === 12
      ? { variant: "nam-nam", ...initialState }
      : INITIAL_OWARE_STATE
  );
  const [animStep, setAnimStep] = useState<OwareAnimationStep | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hoveredPit, setHoveredPit] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [aiDifficultyDepth, setAiDifficultyDepth] = useState<number>(4); // 2 = Easy, 4 = Medium, 6 = Hard
  const [muted, setMuted] = useState(() => !getGameSensoryPreferences().soundEnabled);
  const [vibrationEnabled, setVibrationEnabled] = useState(
    () => getGameSensoryPreferences().vibrationEnabled
  );

  // Animated Hand overlay state (glides from bowl to bowl scooping & dropping seeds)
  const [handPose, setHandPose] = useState<{
    visible: boolean;
    x: number;
    y: number;
    widthPx: number;
    isTopPlayer: boolean;
    isInstant: boolean;
    isPulsing: boolean;
    seedCount: number;
  }>({
    visible: false,
    x: 220,
    y: 120,
    widthPx: 72,
    isTopPlayer: false,
    isInstant: true,
    isPulsing: false,
    seedCount: 0,
  });

  const boardPlanksRef = useRef<HTMLDivElement | null>(null);
  const animTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
    };
  }, []);

  // Measure the center of a pit button inside the hinged ebony board container
  const getPitCenterInsideBoard = useCallback((pitIndex: number) => {
    const boardEl = boardPlanksRef.current;
    if (!boardEl) return { x: 220, y: 120, widthPx: 72 };
    const pitEl = boardEl.querySelector(`[data-pit-index="${pitIndex}"]`) as HTMLElement | null;
    const boardRect = boardEl.getBoundingClientRect();
    if (!pitEl) {
      return {
        x: boardRect.width / 2,
        y: boardRect.height / 2,
        widthPx: 72,
      };
    }
    const pitRect = pitEl.getBoundingClientRect();
    return {
      x: pitRect.left - boardRect.left + pitRect.width / 2,
      y: pitRect.top - boardRect.top + pitRect.height / 2,
      widthPx: Math.max(54, Math.min(96, pitRect.width * 1.25)),
    };
  }, []);

  const getHandRestPosition = useCallback((moverSide: "creator" | "opponent") => {
    const boardEl = boardPlanksRef.current;
    const w = boardEl ? boardEl.offsetWidth : 440;
    const h = boardEl ? boardEl.offsetHeight : 240;
    return {
      x: w / 2,
      y: moverSide === "creator" ? h + 22 : -22,
    };
  }, []);

  // Keep synced with external realtime board_state updates in P2P mode
  useEffect(() => {
    if (
      !isAnimating &&
      initialState &&
      Array.isArray(initialState.pits) &&
      initialState.pits.length === 12 &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame({ variant: game.variant || "nam-nam", ...initialState });
    }
  }, [initialState, game.moveCount, game.variant, isAnimating]);

  // Step-by-step animated sowing player with live SVG Hand gliding across bowls
  const playAnimatedMove = useCallback(
    (
      steps: OwareAnimationStep[],
      finalState: OwareState,
      isLocalMove: boolean,
      moverSide: "creator" | "opponent" = mySide
    ) => {
      if (steps.length === 0) {
        setGame(finalState);
        if (isLocalMove) onStateChange?.(finalState);
        if (finalState.winner) onMatchComplete?.(finalState.winner, finalState);
        return;
      }

      setIsAnimating(true);
      const isTopPlayer = moverSide === "opponent";
      const restPos = getHandRestPosition(moverSide);
      const firstPitMeasure = getPitCenterInsideBoard(steps[0].activePit);

      // Summon hand at player's edge before gliding to the starting bowl
      setHandPose({
        visible: true,
        x: restPos.x,
        y: restPos.y,
        widthPx: firstPitMeasure.widthPx,
        isTopPlayer,
        isInstant: true,
        isPulsing: false,
        seedCount: 0,
      });

      // Cap total animation frames to ~22 steps so long relay chains remain snappy and thrilling
      const stride = steps.length > 24 ? Math.ceil(steps.length / 22) : 1;
      const sampledSteps = steps.filter(
        (s, idx) =>
          idx === 0 ||
          idx === steps.length - 1 ||
          s.type === "pickup" ||
          s.type === "capture" ||
          Boolean(s.harvestedPit !== undefined) ||
          Boolean(s.isRelayScoop) ||
          idx % stride === 0
      );

      let cursor = 0;
      const stepInterval =
        sampledSteps.length > 14 ? HAND_MOVE_DURATION_MS : HAND_MOVE_DURATION_MS + HAND_DROP_PAUSE_MS;

      const tick = () => {
        if (cursor >= sampledSteps.length) {
          const endRest = getHandRestPosition(moverSide);
          setHandPose((prev) => ({
            ...prev,
            visible: false,
            x: endRest.x,
            y: endRest.y,
            isInstant: false,
            isPulsing: false,
            seedCount: 0,
          }));

          setAnimStep(null);
          setIsAnimating(false);
          setGame(finalState);
          if (isLocalMove) onStateChange?.(finalState);

          // Award points when the human player harvests seeds
          if (moverSide === mySide && (finalState.lastMove?.captured || 0) > 0) {
            const capturedCount = finalState.lastMove?.captured || 0;
            onPointsEarned?.(
              capturedCount * 15,
              `Harvested ${capturedCount} Oware seeds (+${capturedCount * 15} Pts)`
            );
          }

          if (finalState.winner) {
            if (!muted) {
              playSuccessSound();
              if (finalState.winner === mySide) playLevelUpFanfare();
            }
            if (finalState.winner === mySide) {
              triggerHapticSensor("victory");
              onPointsEarned?.(300, "Oware Match Victory (+300 Pts)");
            }
            onMatchComplete?.(finalState.winner, finalState);
          }
          return;
        }

        const currentFrame = sampledSteps[cursor];
        setAnimStep(currentFrame);

        const pitCoords = getPitCenterInsideBoard(currentFrame.activePit);
        setHandPose({
          visible: true,
          x: pitCoords.x,
          y: pitCoords.y,
          widthPx: pitCoords.widthPx,
          isTopPlayer,
          isInstant: false,
          isPulsing: true,
          seedCount: currentFrame.inHand,
        });

        window.setTimeout(() => {
          setHandPose((prev) => ({ ...prev, isPulsing: false }));
        }, HAND_DROP_PAUSE_MS);

        if (!muted) {
          if (currentFrame.harvestedPit !== undefined) {
            playSuccessSound();
            triggerHapticSensor("pocket_drop");
          } else {
            playWoodSeedClack(cursor);
            triggerHapticSensor("seed_drop");
          }
        }

        cursor += 1;
        animTimerRef.current = window.setTimeout(tick, stepInterval);
      };

      animTimerRef.current = window.setTimeout(tick, 45);
    },
    [
      muted,
      mySide,
      getPitCenterInsideBoard,
      getHandRestPosition,
      onStateChange,
      onMatchComplete,
      onPointsEarned,
    ]
  );

  const variant: OwareRuleVariant = game.variant || "nam-nam";

  const handleToggleVariant = (nextVariant: OwareRuleVariant) => {
    if (isAnimating || (game.moveCount || 0) > 0) return;
    const updated: OwareState = {
      ...INITIAL_OWARE_STATE,
      variant: nextVariant,
    };
    setGame(updated);
    onStateChange?.(updated);
  };

  const handlePitClick = useCallback(
    (pitIndex: number) => {
      if (game.winner || isAnimating) return;
      if (game.turn !== mySide) return;

      const simResult =
        variant === "nam-nam"
          ? simulateNamNamMoveWithSteps(game, pitIndex, mySide, true)
          : simulateAbapaMoveWithSteps(game, pitIndex, mySide, true);

      if (!simResult) return;

      playAnimatedMove(simResult.steps, simResult.nextState, true, mySide);
    },
    [game, isAnimating, mySide, variant, playAnimatedMove]
  );

  // Trigger Human-Sense Challenger move when playing vs Challenger / Free Data mode
  useEffect(() => {
    if (
      !isAnimating &&
      (mode === "ai" || mode === "free_data") &&
      !game.winner &&
      game.turn === "opponent"
    ) {
      const humanDelay = 620 + Math.floor(Math.random() * 420);
      const timer = window.setTimeout(() => {
        const aiPit = pickBestAiMove(game, playerLevel, aiDifficultyDepth);
        if (aiPit === -1) return;
        const simResult =
          variant === "nam-nam"
            ? simulateNamNamMoveWithSteps(game, aiPit, "opponent", true)
            : simulateAbapaMoveWithSteps(game, aiPit, "opponent", true);
        if (!simResult) return;

        playAnimatedMove(simResult.steps, simResult.nextState, true, "opponent");
      }, humanDelay);

      return () => window.clearTimeout(timer);
    }
  }, [mode, game, isAnimating, variant, playerLevel, aiDifficultyDepth, playAnimatedMove]);

  // Display state (either live animation frame or settled game state)
  const displayPits = animStep ? animStep.pits : game.pits;
  const displayScores = animStep ? animStep.scores : game.scores;
  const legalMovesForTurn = !game.winner && !isAnimating ? getLegalOwareMoves(game, game.turn) : [];
  const otherSide: "creator" | "opponent" = game.turn === "creator" ? "opponent" : "creator";
  const mustFeedOpponent = !game.winner && sumSeedsOnSide(game.pits, otherSide) === 0;

  // Top row (North: Opponent pits 11 down to 6 left-to-right so counter-clockwise flow is visually accurate)
  const northIndices = [11, 10, 9, 8, 7, 6];
  // Bottom row (South: Creator pits 0 up to 5 left-to-right)
  const southIndices = [0, 1, 2, 3, 4, 5];

  const isMyTurn = !game.winner && !isAnimating && game.turn === mySide;

  // Shared Terracotta Carved Bowl styling matching the reference photo
  const terracottaBowlStyle = {
    background:
      "radial-gradient(circle at 36% 30%, #e06d34 0%, #c64f18 48%, #8e2e07 82%, #4a1502 100%)",
    boxShadow:
      "inset 0 8px 16px rgba(0,0,0,0.75), inset 0 -3px 8px rgba(251,146,60,0.28), 0 2px 6px rgba(0,0,0,0.9)",
  };

  return (
    <div className="space-y-4">
      {/* Top Status, Rule Variant Selector & Score Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/95 border border-amber-500/30 shadow-lg">
        <div className="flex flex-wrap items-center gap-2.5">
          <img
            src="/oware-challenge-icon.jpg"
            alt="Ghanaian Oware Board"
            className="w-8 h-8 rounded-lg object-cover shadow-md border border-amber-500/40"
          />
          <Badge className="bg-gradient-to-r from-orange-600 to-amber-500 text-white font-black text-xs px-3 py-1">
            🪨 GHANA OWARE ({variant === "nam-nam" ? "NAM-NAM RELAY" : "ABAPA TOURNAMENT"})
          </Badge>
          {mode !== "p2p" && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px] font-bold gap-1"
            >
              <Brain className="w-3 h-3" />
              {effectiveOpponentName} • {persona.humanSensePercent}% Human Sense (Medium)
            </Badge>
          )}

          {/* Rule Variant Switcher (Available before first move) */}
          <div className="inline-flex items-center rounded-xl bg-slate-950 p-1 border border-white/10">
            <button
              type="button"
              disabled={isAnimating || (game.moveCount || 0) > 0}
              onClick={() => handleToggleVariant("nam-nam")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                variant === "nam-nam"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-white disabled:opacity-40"
              }`}
              title="Traditional Ghanaian Relay Sowing & 4-Seed Harvest"
            >
              🇬🇭 Nam-Nam (4-Seed Relay)
            </button>
            <button
              type="button"
              disabled={isAnimating || (game.moveCount || 0) > 0}
              onClick={() => handleToggleVariant("abapa")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all ${
                variant === "abapa"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-white disabled:opacity-40"
              }`}
              title="Tournament Single-Lap & 2/3 Seed Capture"
            >
              🏆 Abapa (2/3 Capture)
            </button>
          </div>

          {mode !== "p2p" && (
            <select
              aria-label="Computer difficulty"
              value={aiDifficultyDepth}
              onChange={(e) => setAiDifficultyDepth(Number(e.target.value))}
              className="h-7 rounded-xl bg-slate-950 border border-white/15 px-2 text-[10px] font-black text-amber-300"
            >
              <option value={2}>Easy (Depth 2)</option>
              <option value={4}>Medium (Depth 4)</option>
              <option value={6}>Hard (Depth 6)</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRules((v) => !v)}
            className="h-8 text-xs text-amber-300 hover:text-amber-200 gap-1"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            {showRules ? "Hide Rules" : "How to Play"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = !vibrationEnabled;
              setVibrationEnabled(next);
              setGameSensoryPreferences({ vibrationEnabled: next });
              if (next) triggerHapticSensor("aim_tick");
            }}
            className={`h-8 px-2 text-xs gap-1 ${
              vibrationEnabled ? "text-emerald-300" : "text-slate-500"
            }`}
            title="Toggle Haptic Vibration Sensor"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              setGameSensoryPreferences({ soundEnabled: !nextMuted });
            }}
            className="h-8 w-8 p-0 text-amber-300"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {showRules && (
        <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/30 text-xs text-amber-100/90 space-y-2">
          {variant === "nam-nam" ? (
            <>
              <p className="font-black text-amber-400">
                🇬🇭 Ghanaian Oware Nam-Nam Rules (Continuous Relay &amp; 4-Seed Harvest):
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong>Relay Sowing (&quot;Nam-Nam&quot;)</strong>: Tap any of your 6 bowls to scoop up all seeds and sow them <strong>counter-clockwise</strong> one by one. If your <strong>last seed</strong> lands in a bowl that already has seeds, you automatically <strong>scoop them up and keep sowing</strong> until your last seed lands in an empty bowl!
                </li>
                <li>
                  <strong>4-Seed Harvest Rule</strong>: Whenever a bowl reaches <strong>exactly 4 seeds</strong> during sowing, the owner of that row immediately harvests those <strong>4 seeds</strong>!
                </li>
                <li>
                  <strong>Active Sower Bonus</strong>: If the <strong>very last seed in your hand</strong> lands in ANY bowl (yours or your opponent&apos;s) to make <strong>4 seeds</strong>, <strong>YOU capture those 4 seeds</strong>!
                </li>
                <li>
                  <strong>Victory</strong>: First player to capture <strong>25 or more seeds</strong> wins!
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="font-black text-amber-400">
                🏆 Official Oware Abapa Rules (2/3 Capture &amp; Mandatory Feeding):
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong>Single-Lap Sowing</strong>: Tap one of your bowls to sow seeds counter-clockwise (skipping the starting bowl if sowing 12+ seeds).
                </li>
                <li>
                  <strong>2 or 3 Seed Capture</strong>: If your <strong>last seed</strong> lands in your opponent&apos;s row and brings that bowl (plus any consecutive preceding opponent bowls) to <strong>2 or 3 seeds</strong>, you capture them!
                </li>
                <li>
                  <strong>Mandatory Feeding Rule</strong>: If your opponent has 0 seeds, you must play a move that feeds them seeds.
                </li>
              </ul>
            </>
          )}
        </div>
      )}

      {/* Live Turn & Sowing Action Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-white/10 shadow">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isAnimating
                ? "bg-orange-400 animate-ping"
                : isMyTurn
                ? "bg-emerald-400 animate-ping"
                : "bg-amber-400"
            }`}
          />
          <span className="text-xs sm:text-sm font-black text-white">
            {animStep?.eventText ? (
              <span className="text-amber-300">{animStep.eventText}</span>
            ) : game.winner ? (
              game.winner === "draw" ? (
                "🤝 Match Ended in a 24–24 Draw!"
              ) : game.winner === mySide ? (
                "🏆 VICTORY! YOU WON THE OWARE CHALLENGE!"
              ) : (
                `🏅 ${game.winner === "creator" ? creatorName : effectiveOpponentName} Won the Oware Match!`
              )
            ) : isMyTurn ? (
              mustFeedOpponent ? (
                "🟢 YOUR TURN — Your opponent has no seeds, so you must pick a glowing bowl that feeds them!"
              ) : (
                "🟢 YOUR TURN — Tap any of your glowing terracotta bowls to sow!"
              )
            ) : (
              `⏳ ${game.turn === "creator" ? creatorName : effectiveOpponentName} is sowing...`
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {animStep && (
            <Badge className="bg-amber-500 text-slate-950 font-black text-xs animate-pulse gap-1">
              <Sparkles className="w-3.5 h-3.5" />✋ In Hand: {animStep.inHand} seeds
            </Badge>
          )}
          {!animStep && game.lastMove?.summary && (
            <Badge
              variant="outline"
              className="text-[11px] border-amber-500/40 text-amber-300 bg-amber-500/10"
            >
              {game.lastMove.summary}
            </Badge>
          )}
        </div>
      </div>

      {/* AUTHENTIC HINGED MATTE-BLACK EBONY & CARVED TERRACOTTA OWARE BOARD */}
      <div className="relative p-3 sm:p-5 rounded-[36px] bg-slate-950/90 border border-white/10 shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-8 gap-4 items-center">
          {/* Opponent Kulo Storehouse (Left Ebony Bowl) */}
          <div
            className={`flex lg:flex-col items-center justify-between lg:justify-center p-3.5 rounded-[36px] border-2 transition-all shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[115px] lg:min-h-[270px] ${
              animStep?.harvestedBy === "opponent"
                ? "border-amber-400 ring-4 ring-amber-400/30 scale-[1.03]"
                : "border-[#35373d]"
            }`}
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-center mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-orange-300 truncate max-w-[115px]">
                {effectiveOpponentName}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-white font-mono">
                {displayScores.opponent}
                <span className="text-xs text-slate-400">/25</span>
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center"
              style={terracottaBowlStyle}
            >
              <NickernutSeedCluster count={displayScores.opponent} pitSeedOffset={20} />
            </div>
          </div>

          {/* TWO HINGED MATTE-BLACK EBONY PLANKS WITH BRASS HINGES, 12 TERRACOTTA BOWLS & ANIMATED SOWING HAND */}
          <div ref={boardPlanksRef} className="lg:col-span-6 relative space-y-1.5">
            <OwareAnimatedHand {...handPose} />

            {/* TOP EBONY PLANK — Opponent's 6 Carved Terracotta Bowls (North: 11..6) */}
            <div
              className="relative px-3.5 sm:px-6 py-3.5 sm:py-5 rounded-[44px] sm:rounded-[64px] border-2 border-[#34363c] shadow-[0_14px_28px_rgba(0,0,0,0.9),inset_0_2px_4px_rgba(255,255,255,0.1)]"
              style={{
                background: "linear-gradient(180deg, #26272b 0%, #191a1d 55%, #121316 100%)",
              }}
            >
              <div className="flex items-center justify-between mb-2 px-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-300/90">
                  ← {effectiveOpponentName}&apos;s Row (Counter-Clockwise 12 → 7)
                </span>
                {mySide === "opponent" && isMyTurn && (
                  <span className="text-[10px] font-black text-emerald-400 animate-pulse">
                    Tap a bowl below ↓
                  </span>
                )}
              </div>

              <div className="grid grid-cols-6 gap-2 sm:gap-3.5">
                {northIndices.map((pitIdx) => {
                  const count = displayPits[pitIdx];
                  const isLegal =
                    mySide === "opponent" &&
                    isMyTurn &&
                    legalMovesForTurn.includes(pitIdx);
                  const isActiveAnim = animStep?.activePit === pitIdx;
                  const isLastSownAnim = animStep?.lastSownPit === pitIdx;
                  const isHarvestedAnim =
                    animStep?.harvestedPit === pitIdx ||
                    Boolean(animStep?.capturedPits?.includes(pitIdx));
                  const isRelayAnim = animStep?.activePit === pitIdx && animStep?.isRelayScoop;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      data-pit-index={pitIdx}
                      aria-label={`Pit ${pitIdx + 1}, ${count} seeds`}
                      disabled={!isLegal}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all duration-150 border-[3px] ${
                        isHarvestedAnim
                          ? "border-[#ff5a4d] ring-4 ring-[#ff5a4d]/70 scale-110 z-20"
                          : isRelayAnim
                          ? "border-sky-400 ring-4 ring-sky-400/50 scale-110 z-20"
                          : isLastSownAnim || isActiveAnim
                          ? "border-[#5ad1c4] ring-4 ring-[#5ad1c4]/55 scale-105 z-10"
                          : isLegal
                          ? "border-[#f2c14e] hover:border-[#ffe08a] hover:scale-105 cursor-pointer ring-4 ring-[#f2c14e]/35"
                          : "border-[#2d1206] cursor-default"
                      }`}
                    >
                      {/* Pit Number Label */}
                      <span className="absolute -top-2 text-[9px] font-mono font-bold text-slate-400 bg-[#18191c] px-1.5 rounded-full border border-white/10">
                        #{pitIdx + 1}
                      </span>

                      <NickernutSeedCluster count={count} pitSeedOffset={pitIdx * 3} />

                      {/* Harvest Popup Badge */}
                      {isHarvestedAnim && (
                        <span className="absolute inset-0 flex items-center justify-center bg-amber-500/90 rounded-full text-slate-950 font-black text-xs animate-bounce">
                          +4 🔥
                        </span>
                      )}

                      {/* Seed Count Badge */}
                      <span
                        className={`absolute -bottom-1.5 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black font-mono shadow-md border ${
                          isActiveAnim
                            ? "bg-amber-400 text-slate-950 border-white scale-110"
                            : count === 3 && variant === "nam-nam"
                            ? "bg-orange-500 text-white border-amber-200"
                            : count > 0
                            ? "bg-[#18191c] text-[#d9e298] border-[#4b5320]"
                            : "bg-black/80 text-slate-500 border-white/10"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CENTER FOLD SEAM WITH 2 AUTHENTIC BRASS HINGES (Matches Reference Photo!) */}
            <div className="relative h-2 flex items-center justify-between px-12 sm:px-20 pointer-events-none z-20">
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-[3px] bg-black shadow-[0_1px_2px_rgba(255,255,255,0.08)]" />
              <BrassHinge />
              <span className="px-3 py-0.5 rounded-full bg-[#141518] border border-white/10 text-[9px] font-bold uppercase tracking-widest text-amber-400/80 flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" />
                {variant === "nam-nam"
                  ? "↺ Nam-Nam Relay • 4 Seeds = Harvest ↺"
                  : "↺ Abapa Tournament • 2 or 3 Seeds = Capture ↺"}
              </span>
              <BrassHinge />
            </div>

            {/* BOTTOM EBONY PLANK — Creator's 6 Carved Terracotta Bowls (South: 0..5) */}
            <div
              className="relative px-3.5 sm:px-6 py-3.5 sm:py-5 rounded-[44px] sm:rounded-[64px] border-2 border-[#34363c] shadow-[0_16px_32px_rgba(0,0,0,0.95),inset_0_2px_4px_rgba(255,255,255,0.1)]"
              style={{
                background: "linear-gradient(180deg, #26272b 0%, #191a1d 55%, #121316 100%)",
              }}
            >
              <div className="grid grid-cols-6 gap-2 sm:gap-3.5">
                {southIndices.map((pitIdx) => {
                  const count = displayPits[pitIdx];
                  const isLegal =
                    mySide === "creator" &&
                    isMyTurn &&
                    legalMovesForTurn.includes(pitIdx);
                  const isActiveAnim = animStep?.activePit === pitIdx;
                  const isLastSownAnim = animStep?.lastSownPit === pitIdx;
                  const isHarvestedAnim =
                    animStep?.harvestedPit === pitIdx ||
                    Boolean(animStep?.capturedPits?.includes(pitIdx));
                  const isRelayAnim = animStep?.activePit === pitIdx && animStep?.isRelayScoop;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      data-pit-index={pitIdx}
                      aria-label={`Pit ${pitIdx + 1}, ${count} seeds`}
                      disabled={!isLegal}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all duration-150 border-[3px] ${
                        isHarvestedAnim
                          ? "border-[#ff5a4d] ring-4 ring-[#ff5a4d]/70 scale-110 z-20"
                          : isRelayAnim
                          ? "border-sky-400 ring-4 ring-sky-400/50 scale-110 z-20"
                          : isLastSownAnim || isActiveAnim
                          ? "border-[#5ad1c4] ring-4 ring-[#5ad1c4]/55 scale-105 z-10"
                          : isLegal
                          ? "border-[#f2c14e] hover:border-[#ffe08a] hover:scale-105 cursor-pointer ring-4 ring-[#f2c14e]/35"
                          : "border-[#2d1206] cursor-default"
                      }`}
                    >
                      {/* Pit Number Label */}
                      <span className="absolute -top-2 text-[9px] font-mono font-bold text-slate-400 bg-[#18191c] px-1.5 rounded-full border border-white/10">
                        #{pitIdx + 1}
                      </span>

                      <NickernutSeedCluster count={count} pitSeedOffset={pitIdx * 5 + 1} />

                      {/* Harvest Popup Badge */}
                      {isHarvestedAnim && (
                        <span className="absolute inset-0 flex items-center justify-center bg-amber-500/90 rounded-full text-slate-950 font-black text-xs animate-bounce">
                          +4 🔥
                        </span>
                      )}

                      {/* Seed Count Badge */}
                      <span
                        className={`absolute -bottom-1.5 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black font-mono shadow-md border ${
                          isActiveAnim
                            ? "bg-amber-400 text-slate-950 border-white scale-110"
                            : isLegal
                            ? "bg-emerald-500 text-slate-950 border-white"
                            : count > 0
                            ? "bg-[#18191c] text-[#d9e298] border-[#4b5320]"
                            : "bg-black/80 text-slate-500 border-white/10"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mt-3 px-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-300/90">
                  {creatorName}&apos;s Row (Counter-Clockwise 1 → 6 {mySide === "creator" ? "• YOU" : ""}) →
                </span>
                {mySide === "creator" && isMyTurn && (
                  <span className="text-[10px] font-black text-emerald-400 animate-pulse">
                    Tap any glowing terracotta bowl ↑
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Creator Kulo Storehouse (Right Ebony Bowl) */}
          <div
            className={`flex lg:flex-col items-center justify-between lg:justify-center p-3.5 rounded-[36px] border-2 transition-all shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[115px] lg:min-h-[270px] ${
              animStep?.harvestedBy === "creator"
                ? "border-emerald-400 ring-4 ring-emerald-400/30 scale-[1.03]"
                : "border-[#35373d]"
            }`}
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-center mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-400 truncate max-w-[115px]">
                {creatorName}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono">
                {displayScores.creator}
                <span className="text-xs text-slate-400">/25</span>
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center"
              style={terracottaBowlStyle}
            >
              <NickernutSeedCluster count={displayScores.creator} pitSeedOffset={40} />
            </div>
          </div>
        </div>

        {/* Hover Move Preview Bar */}
        {hoveredPit !== null && isMyTurn && displayPits[hoveredPit] > 0 && (
          <div className="mt-3 text-center text-xs text-amber-200/90 font-semibold">
            {variant === "nam-nam" ? (
              <>
                Scooping <strong>{displayPits[hoveredPit]} seeds</strong> from Bowl #{hoveredPit + 1} — first lap lands in{" "}
                <strong>Bowl #{((hoveredPit + displayPits[hoveredPit]) % 12) + 1}</strong>{" "}
                (if non-empty, relay continues!)
              </>
            ) : (
              <>
                Sowing <strong>{displayPits[hoveredPit]} seeds</strong> from Bowl #{hoveredPit + 1} counter-clockwise...
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
