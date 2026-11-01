import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, HelpCircle, Sparkles, Flame } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";

export type OwareRuleVariant = "nam-nam" | "abapa";

export interface OwareAnimationStep {
  pits: number[];
  scores: { creator: number; opponent: number };
  activePit: number;
  inHand: number;
  eventText?: string;
  harvestedPit?: number;
  harvestedBy?: "creator" | "opponent";
  isRelayScoop?: boolean;
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

/**
 * 1. GHANAIAN OWARE NAM-NAM ENGINE (Continuous Relay Sowing & 4-Seed Harvest)
 * - Pick up all seeds from chosen bowl and sow counter-clockwise.
 * - Pass-through 4-Seed Rule: If any bowl reaches 4 seeds BEFORE the last seed in hand is dropped,
 *   the owner of that row immediately harvests those 4 seeds!
 * - Last-Seed 4-Seed Rule: If the VERY LAST seed in hand lands in a bowl (either row) and makes it 4 seeds,
 *   the ACTIVE SOWER harvests those 4 seeds, and the turn ends (bowl is now empty).
 * - Continuous Relay Rule: If the last seed in hand lands in a non-empty bowl (now > 1 seed and != 4),
 *   the active player immediately scoops up all seeds from that bowl and continues sowing!
 * - Turn ends when the last seed in hand lands in an empty bowl (making it 1 seed).
 * - Final 8 Seeds Rule: When <= 8 seeds remain on the board and a 4-seed harvest occurs, the remaining 4 seeds
 *   are also swept by the harvesting player.
 */
export function simulateNamNamMoveWithSteps(
  state: OwareState,
  startPit: number,
  player: "creator" | "opponent",
  recordSteps = false
): { nextState: OwareState; steps: OwareAnimationStep[] } | null {
  if (state.winner) return null;
  if (player === "creator" && (startPit < 0 || startPit > 5)) return null;
  if (player === "opponent" && (startPit < 6 || startPit > 11)) return null;
  if (!state.pits[startPit] || state.pits[startPit] <= 0) return null;

  const pits = [...state.pits];
  const scores = { ...state.scores };
  const steps: OwareAnimationStep[] = [];

  let inHand = pits[startPit];
  pits[startPit] = 0;
  let currentPit = startPit;
  let laps = 1;
  let safetyCounter = 0;
  const scoreBefore = scores[player];

  if (recordSteps) {
    steps.push({
      pits: [...pits],
      scores: { ...scores },
      activePit: startPit,
      inHand,
      eventText: `Scooped ${inHand} seeds from Bowl #${startPit + 1}`,
    });
  }

  while (inHand > 0 && safetyCounter < 240) {
    safetyCounter += 1;
    currentPit = (currentPit + 1) % 12;
    pits[currentPit] += 1;
    inHand -= 1;

    const isLastSeedInHand = inHand === 0;

    // Check 4-Seed Harvest Rule
    if (pits[currentPit] === 4) {
      pits[currentPit] = 0;
      // If it was the very last seed in hand, active sower captures the 4 seeds!
      // Otherwise, the owner of the row (0..5 = creator, 6..11 = opponent) captures them!
      const harvester: "creator" | "opponent" = isLastSeedInHand
        ? player
        : currentPit <= 5
        ? "creator"
        : "opponent";

      scores[harvester] += 4;

      // Final 8 seeds sweep rule: if exactly 4 seeds remain on the entire board after a harvest, harvester sweeps them too
      const totalRemainingOnBoard = pits.reduce((a, b) => a + b, 0) + inHand;
      if (totalRemainingOnBoard === 4 && inHand === 0) {
        for (let i = 0; i < 12; i++) pits[i] = 0;
        scores[harvester] += 4;
      }

      if (recordSteps) {
        steps.push({
          pits: [...pits],
          scores: { ...scores },
          activePit: currentPit,
          inHand,
          harvestedPit: currentPit,
          harvestedBy: harvester,
          eventText: isLastSeedInHand
            ? `🔥 Final seed made 4 in Bowl #${currentPit + 1}! +4 harvested!`
            : `✨ Bowl #${currentPit + 1} reached 4 seeds! +4 harvested!`,
        });
      }

      // If it was the last seed in hand, the bowl is now empty (0) after harvesting, so turn ends!
      if (isLastSeedInHand) {
        break;
      }
      continue;
    }

    if (recordSteps) {
      steps.push({
        pits: [...pits],
        scores: { ...scores },
        activePit: currentPit,
        inHand,
      });
    }

    // Relay Rule: Last seed landed in a bowl that ALREADY had seeds (now > 1 and != 4)
    if (isLastSeedInHand && pits[currentPit] > 1) {
      inHand = pits[currentPit];
      pits[currentPit] = 0;
      laps += 1;

      if (recordSteps) {
        steps.push({
          pits: [...pits],
          scores: { ...scores },
          activePit: currentPit,
          inHand,
          isRelayScoop: true,
          eventText: `🔄 NAM-NAM RELAY! Scooped ${inHand} seeds from Bowl #${currentPit + 1} (Lap #${laps})`,
        });
      }
    }
  }

  const nextTurn: "creator" | "opponent" = player === "creator" ? "opponent" : "creator";
  const nextTurnStart = nextTurn === "creator" ? 0 : 6;
  const nextTurnEnd = nextTurn === "creator" ? 5 : 11;
  const nextTurnSeeds = pits.slice(nextTurnStart, nextTurnEnd + 1).reduce((a, b) => a + b, 0);
  const currentTurnSeeds = pits
    .slice(player === "creator" ? 0 : 6, (player === "creator" ? 5 : 11) + 1)
    .reduce((a, b) => a + b, 0);

  // If next player has 0 seeds on their side, check if current player must keep turn or if board is cleared
  let finalTurn: "creator" | "opponent" = nextTurn;
  if (nextTurnSeeds === 0 && currentTurnSeeds > 0) {
    // If opponent's row is empty, check if any move from current player can reach opponent's row
    const canFeed = pits
      .slice(player === "creator" ? 0 : 6, (player === "creator" ? 5 : 11) + 1)
      .some((count, idx) => count + idx >= 6);
    if (canFeed) {
      finalTurn = player; // Same player plays again to feed
    } else {
      // Harvest remaining seeds
      for (let i = 0; i < 12; i++) {
        if (i <= 5) scores.creator += pits[i];
        else scores.opponent += pits[i];
        pits[i] = 0;
      }
    }
  } else if (nextTurnSeeds === 0 && currentTurnSeeds === 0) {
    for (let i = 0; i < 12; i++) pits[i] = 0;
  }

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;
  const boardEmpty = pits.every((p) => p === 0);

  if (scores.creator >= 25) winner = "creator";
  else if (scores.opponent >= 25) winner = "opponent";
  else if (boardEmpty || totalMoveCount >= 100) {
    const remCreator = pits.slice(0, 6).reduce((a, b) => a + b, 0);
    const remOpponent = pits.slice(6, 12).reduce((a, b) => a + b, 0);
    scores.creator += remCreator;
    scores.opponent += remOpponent;
    for (let i = 0; i < 12; i++) pits[i] = 0;
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
      pits: [...nextPits],
      scores: { ...state.scores },
      activePit: pitIndex,
      inHand: remaining,
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
        pits: [...nextPits],
        scores: { ...state.scores },
        activePit: currentPit,
        inHand: remaining,
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
  }

  const nextScores = {
    creator: state.scores.creator + (player === "creator" ? captured : 0),
    opponent: state.scores.opponent + (player === "opponent" ? captured : 0),
  };

  if (recordSteps && captured > 0) {
    steps.push({
      pits: [...finalPits],
      scores: { ...nextScores },
      activePit: capturedIndices[0] ?? currentPit,
      inHand: 0,
      harvestedPit: capturedIndices[0] ?? currentPit,
      harvestedBy: player,
      eventText: `🔥 Abapa Capture! Harvested +${captured} seeds!`,
    });
  }

  const nextTurn: "creator" | "opponent" = player === "creator" ? "opponent" : "creator";
  const nextTurnStart = nextTurn === "creator" ? 0 : 6;
  const nextTurnEnd = nextTurn === "creator" ? 5 : 11;
  const nextTurnSeeds = finalPits
    .slice(nextTurnStart, nextTurnEnd + 1)
    .reduce((a, b) => a + b, 0);

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;

  if (nextScores.creator >= 25) {
    winner = "creator";
  } else if (nextScores.opponent >= 25) {
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
      if (s === 3) aiVulnerablePits += 1; // In Nam-Nam, 3 seeds can be sniped by human's last seed to make 4
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
  if (depth === 0 || state.winner) {
    return evaluateOwareBoard(state);
  }

  if (maximizing) {
    let maxEval = -Infinity;
    let moved = false;
    for (let i = 6; i <= 11; i++) {
      if (state.pits[i] <= 0) continue;
      const next = simulateOwareMove(state, i, "opponent");
      if (!next) continue;
      moved = true;
      const nextIsMax = next.turn === "opponent";
      const val = minimaxOware(next, depth - 1, alpha, beta, nextIsMax);
      if (val > maxEval) maxEval = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return moved ? maxEval : evaluateOwareBoard(state);
  } else {
    let minEval = Infinity;
    let moved = false;
    for (let i = 0; i <= 5; i++) {
      if (state.pits[i] <= 0) continue;
      const next = simulateOwareMove(state, i, "creator");
      if (!next) continue;
      moved = true;
      const nextIsMax = next.turn === "opponent";
      const val = minimaxOware(next, depth - 1, alpha, beta, nextIsMax);
      if (val < minEval) minEval = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return moved ? minEval : evaluateOwareBoard(state);
  }
}

/** Choose best AI move using deep Alpha-Beta Pruning Grandmaster lookahead */
function pickBestAiMove(state: OwareState): number {
  const validPits: number[] = [];
  for (let i = 6; i <= 11; i++) {
    if (state.pits[i] > 0 && simulateOwareMove(state, i, "opponent")) {
      validPits.push(i);
    }
  }
  if (validPits.length === 0) return -1;

  let bestPit = validPits[0];
  let bestScore = -Infinity;
  const searchDepth = (state.variant || "nam-nam") === "nam-nam" ? 4 : 5;

  for (const pit of validPits) {
    const sim1 = simulateOwareMove(state, pit, "opponent");
    if (!sim1) continue;
    const score = minimaxOware(
      sim1,
      searchDepth,
      -Infinity,
      Infinity,
      sim1.turn === "opponent"
    );
    if (score > bestScore) {
      bestScore = score;
      bestPit = pit;
    }
  }

  return bestPit;
}

/**
 * Authentic Olive-Green & Sage-Grey Nickernut Seed Pebble (matches reference photo)
 */
const SEED_PALETTES = [
  "radial-gradient(circle at 32% 28%, #b8c470 0%, #8b9a46 58%, #546022 100%)", // Olive green
  "radial-gradient(circle at 32% 28%, #d2d1c5 0%, #a5a392 58%, #696759 100%)", // Sage pebble grey
  "radial-gradient(circle at 32% 28%, #aebc62 0%, #7d8c38 58%, #4a551c 100%)", // Deep olive
  "radial-gradient(circle at 32% 28%, #c5c8a8 0%, #969b74 58%, #5e6342 100%)", // Moss grey-green
  "radial-gradient(circle at 32% 28%, #dcdad0 0%, #b2afa0 58%, #757264 100%)", // Warm stone grey
];

const SEED_OFFSETS: { x: number; y: number; rot: number }[] = [
  { x: -24, y: -20, rot: -15 },
  { x: 22, y: -18, rot: 25 },
  { x: -18, y: 22, rot: 12 },
  { x: 20, y: 20, rot: -28 },
  { x: 0, y: 0, rot: 8 },
  { x: 0, y: -28, rot: -5 },
  { x: -28, y: 2, rot: 35 },
  { x: 28, y: 3, rot: -18 },
  { x: 2, y: 28, rot: 20 },
  { x: -12, y: -8, rot: 42 },
  { x: 13, y: -7, rot: -32 },
  { x: -9, y: 12, rot: 15 },
];

function NickernutSeedCluster({ count, pitSeedOffset }: { count: number; pitSeedOffset: number }) {
  const visibleCount = Math.min(count, 12);
  return (
    <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
      {Array.from({ length: visibleCount }).map((_, idx) => {
        const pos = SEED_OFFSETS[idx % SEED_OFFSETS.length];
        const bg = SEED_PALETTES[(pitSeedOffset + idx) % SEED_PALETTES.length];
        return (
          <span
            key={idx}
            className="absolute w-3.5 h-3 sm:w-4 sm:h-3.5 rounded-[52%_48%_48%_52%] shadow-[0_3px_5px_rgba(0,0,0,0.75),inset_0_1px_2px_rgba(255,255,255,0.45)] border border-black/30 transition-all duration-150"
            style={{
              background: bg,
              transform: `translate(${pos.x}%, ${pos.y}%) rotate(${pos.rot}deg)`,
            }}
          />
        );
      })}
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
}

export function OwareGameBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
}: OwareGameBoardProps) {
  const [game, setGame] = useState<OwareState>(() =>
    initialState && Array.isArray(initialState.pits) && initialState.pits.length === 12
      ? { variant: "nam-nam", ...initialState }
      : INITIAL_OWARE_STATE
  );
  const [animStep, setAnimStep] = useState<OwareAnimationStep | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hoveredPit, setHoveredPit] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [muted, setMuted] = useState(false);
  const animTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
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

  // Step-by-step animated sowing player
  const playAnimatedMove = useCallback(
    (
      steps: OwareAnimationStep[],
      finalState: OwareState,
      isLocalMove: boolean
    ) => {
      if (steps.length === 0) {
        setGame(finalState);
        if (isLocalMove) onStateChange?.(finalState);
        if (finalState.winner) onMatchComplete?.(finalState.winner, finalState);
        return;
      }

      setIsAnimating(true);
      // Cap total animation frames to ~18 steps so long relay chains remain snappy and thrilling
      const stride = steps.length > 20 ? Math.ceil(steps.length / 18) : 1;
      const sampledSteps = steps.filter(
        (s, idx) =>
          idx === 0 ||
          idx === steps.length - 1 ||
          Boolean(s.harvestedPit !== undefined) ||
          Boolean(s.isRelayScoop) ||
          idx % stride === 0
      );

      let cursor = 0;
      const stepInterval = sampledSteps.length > 12 ? 125 : 165;

      const tick = () => {
        if (cursor >= sampledSteps.length) {
          setAnimStep(null);
          setIsAnimating(false);
          setGame(finalState);
          if (isLocalMove) onStateChange?.(finalState);
          if (finalState.winner) {
            if (!muted) playSuccessSound();
            onMatchComplete?.(finalState.winner, finalState);
          }
          return;
        }

        const currentFrame = sampledSteps[cursor];
        setAnimStep(currentFrame);

        if (!muted) {
          if (currentFrame.harvestedPit !== undefined) playSuccessSound();
          else playSound("click");
        }

        cursor += 1;
        animTimerRef.current = window.setTimeout(tick, stepInterval);
      };

      tick();
    },
    [muted, onStateChange, onMatchComplete]
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

      playAnimatedMove(simResult.steps, simResult.nextState, true);
    },
    [game, isAnimating, mySide, variant, playAnimatedMove]
  );

  // Trigger AI move when playing vs AI / Free Data mode
  useEffect(() => {
    if (
      !isAnimating &&
      (mode === "ai" || mode === "free_data") &&
      !game.winner &&
      game.turn === "opponent"
    ) {
      const timer = window.setTimeout(() => {
        const aiPit = pickBestAiMove(game);
        if (aiPit === -1) return;
        const simResult =
          variant === "nam-nam"
            ? simulateNamNamMoveWithSteps(game, aiPit, "opponent", true)
            : simulateAbapaMoveWithSteps(game, aiPit, "opponent", true);
        if (!simResult) return;

        playAnimatedMove(simResult.steps, simResult.nextState, true);
      }, 650);

      return () => window.clearTimeout(timer);
    }
  }, [mode, game, isAnimating, variant, playAnimatedMove]);

  // Display state (either live animation frame or settled game state)
  const displayPits = animStep ? animStep.pits : game.pits;
  const displayScores = animStep ? animStep.scores : game.scores;

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
            onClick={() => setMuted((m) => !m)}
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
                `🏅 ${game.winner === "creator" ? creatorName : opponentName} Won the Oware Match!`
              )
            ) : isMyTurn ? (
              "🟢 YOUR TURN — Tap any of your glowing terracotta bowls to sow!"
            ) : (
              `⏳ ${game.turn === "creator" ? creatorName : opponentName} is sowing...`
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
                {opponentName}
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

          {/* TWO HINGED MATTE-BLACK EBONY PLANKS WITH BRASS HINGES & 12 TERRACOTTA BOWLS */}
          <div className="lg:col-span-6 relative space-y-1.5">
            {/* TOP EBONY PLANK — Opponent's 6 Carved Terracotta Bowls (North: 11..6) */}
            <div
              className="relative px-3.5 sm:px-6 py-3.5 sm:py-5 rounded-[44px] sm:rounded-[64px] border-2 border-[#34363c] shadow-[0_14px_28px_rgba(0,0,0,0.9),inset_0_2px_4px_rgba(255,255,255,0.1)]"
              style={{
                background: "linear-gradient(180deg, #26272b 0%, #191a1d 55%, #121316 100%)",
              }}
            >
              <div className="flex items-center justify-between mb-2 px-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-300/90">
                  ← {opponentName}&apos;s Row (Counter-Clockwise 12 → 7)
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
                    count > 0 &&
                    Boolean(simulateOwareMove(game, pitIdx, "opponent"));
                  const isActiveAnim = animStep?.activePit === pitIdx;
                  const isHarvestedAnim = animStep?.harvestedPit === pitIdx;
                  const isRelayAnim = animStep?.activePit === pitIdx && animStep?.isRelayScoop;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      disabled={!isLegal}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all duration-150 border-[3px] ${
                        isHarvestedAnim
                          ? "border-amber-300 ring-4 ring-amber-400 scale-110 z-20"
                          : isRelayAnim
                          ? "border-sky-400 ring-4 ring-sky-400/50 scale-110 z-20"
                          : isActiveAnim
                          ? "border-amber-400 ring-4 ring-amber-400/40 scale-105 z-10"
                          : isLegal
                          ? "border-emerald-400 hover:scale-105 cursor-pointer ring-4 ring-emerald-500/25"
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
                    count > 0 &&
                    Boolean(simulateOwareMove(game, pitIdx, "creator"));
                  const isActiveAnim = animStep?.activePit === pitIdx;
                  const isHarvestedAnim = animStep?.harvestedPit === pitIdx;
                  const isRelayAnim = animStep?.activePit === pitIdx && animStep?.isRelayScoop;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      disabled={!isLegal}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all duration-150 border-[3px] ${
                        isHarvestedAnim
                          ? "border-amber-300 ring-4 ring-amber-400 scale-110 z-20"
                          : isRelayAnim
                          ? "border-sky-400 ring-4 ring-sky-400/50 scale-110 z-20"
                          : isActiveAnim
                          ? "border-amber-400 ring-4 ring-amber-400/40 scale-105 z-10"
                          : isLegal
                          ? "border-emerald-400 hover:scale-105 cursor-pointer ring-4 ring-emerald-500/30"
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
