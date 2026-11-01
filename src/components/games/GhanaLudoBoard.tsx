import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Shield } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";

export interface LudoState {
  // Each player has 4 tokens: -1 = in yard, 0..27 = steps travelled from own start, 28..30 = home stretch, 31 = finished home
  creatorTokens: number[];
  opponentTokens: number[];
  turn: "creator" | "opponent";
  diceValue: number | null;
  phase: "roll" | "move";
  lastAction?: string;
  winner?: "creator" | "opponent" | null;
  moveCount: number;
}

export const INITIAL_LUDO_STATE: LudoState = {
  creatorTokens: [0, -1, -1, -1], // Start with 1 token on starting star so games start fast!
  opponentTokens: [0, -1, -1, -1],
  turn: "creator",
  diceValue: null,
  phase: "roll",
  lastAction: "Tap the 3D Blue Dice to begin the Ghana Ludo Challenge!",
  winner: null,
  moveCount: 0,
};

const SAFE_ABSOLUTE_SQUARES = new Set([0, 7, 14, 21]);

// Maps the 28-step main perimeter track to exact (row, col) cells on the 15x15 Ludo Cross Board
const PERIMETER_COORDS: [number, number][] = [
  // Quadrant 0: Red Start (Bottom-Left) -> Left Arm
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 4],
  [8, 2],
  // Quadrant 1: Green Start (Top-Left) -> Top Arm
  [6, 1],
  [6, 3],
  [6, 5],
  [5, 6],
  [3, 6],
  [1, 6],
  [0, 7],
  // Quadrant 2: Yellow Start (Top-Right) -> Right Arm
  [1, 8],
  [3, 8],
  [5, 8],
  [6, 9],
  [6, 11],
  [6, 13],
  [7, 14],
  // Quadrant 3: Blue Start (Bottom-Right) -> Bottom Arm
  [8, 13],
  [8, 11],
  [8, 9],
  [9, 8],
  [11, 8],
  [13, 8],
  [14, 7],
];

// Red (Creator) Home Stretch (col 7, rows 12 -> 9)
const CREATOR_HOME_STRETCH: [number, number][] = [
  [12, 7],
  [11, 7],
  [9, 7],
];

// Yellow/Green (Opponent) Home Stretch (col 7, rows 2 -> 5)
const OPPONENT_HOME_STRETCH: [number, number][] = [
  [2, 7],
  [3, 7],
  [5, 7],
];

function toAbsoluteSquare(side: "creator" | "opponent", relStep: number): number | null {
  if (relStep < 0 || relStep > 27) return null;
  const offset = side === "creator" ? 0 : 14;
  return (relStep + offset) % 28;
}

function getTokenBoardCoord(side: "creator" | "opponent", relStep: number): [number, number] | null {
  if (relStep < 0 || relStep >= 31) return null;
  if (relStep <= 27) {
    const absIdx = toAbsoluteSquare(side, relStep);
    return absIdx !== null ? PERIMETER_COORDS[absIdx] : null;
  }
  const stretchIdx = relStep - 28; // 0, 1, 2
  return side === "creator"
    ? CREATOR_HOME_STRETCH[stretchIdx] || [9, 7]
    : OPPONENT_HOME_STRETCH[stretchIdx] || [5, 7];
}

export function canMoveLudoToken(tokens: number[], tokenIdx: number, dice: number): boolean {
  const pos = tokens[tokenIdx];
  if (pos === 31) return false;
  if (pos === -1) return dice === 6;
  return pos + dice <= 31;
}

export function applyLudoTokenMove(
  state: LudoState,
  side: "creator" | "opponent",
  tokenIdx: number
): LudoState | null {
  const dice = state.diceValue;
  if (!dice || state.phase !== "move" || state.turn !== side || state.winner) return null;

  const myTokens = side === "creator" ? [...state.creatorTokens] : [...state.opponentTokens];
  const oppTokens = side === "creator" ? [...state.opponentTokens] : [...state.creatorTokens];

  if (!canMoveLudoToken(myTokens, tokenIdx, dice)) return null;

  const currentPos = myTokens[tokenIdx];
  const nextPos = currentPos === -1 ? 0 : currentPos + dice;
  myTokens[tokenIdx] = nextPos;

  let kickedOpponent = false;
  let actionLog =
    currentPos === -1
      ? `${side === "creator" ? "Red" : "Yellow"} brought Token #${tokenIdx + 1} out of the Yard!`
      : `${side === "creator" ? "Red" : "Yellow"} advanced Token #${tokenIdx + 1} by ${dice}.`;

  // Check if landed on opponent token on main 28-square perimeter
  if (nextPos >= 0 && nextPos <= 27) {
    const myAbs = toAbsoluteSquare(side, nextPos);
    const oppSide = side === "creator" ? "opponent" : "creator";
    if (myAbs !== null && !SAFE_ABSOLUTE_SQUARES.has(myAbs)) {
      for (let i = 0; i < oppTokens.length; i++) {
        const oppAbs = toAbsoluteSquare(oppSide, oppTokens[i]);
        if (oppAbs !== null && oppAbs === myAbs) {
          oppTokens[i] = -1; // Kick back to yard!
          kickedOpponent = true;
          actionLog = `💥 KICK! ${side === "creator" ? "Red" : "Yellow"} kicked opponent's Token #${i + 1} back to Yard! Bonus Roll!`;
        }
      }
    }
  }

  if (nextPos === 31) {
    actionLog = `🏠 HOME! ${side === "creator" ? "Red" : "Yellow"} brought Token #${tokenIdx + 1} into the Center Home!`;
  }

  const creatorNext = side === "creator" ? myTokens : oppTokens;
  const opponentNext = side === "creator" ? oppTokens : myTokens;

  // Win condition: First player to get 2 tokens home (pos === 31) wins the fast-match!
  const creatorHomeCount = creatorNext.filter((p) => p === 31).length;
  const opponentHomeCount = opponentNext.filter((p) => p === 31).length;

  let winner: "creator" | "opponent" | null = null;
  if (creatorHomeCount >= 2) winner = "creator";
  else if (opponentHomeCount >= 2) winner = "opponent";

  // Bonus roll on rolling a 6, kicking an opponent, or reaching home
  const earnedBonusTurn = !winner && (dice === 6 || kickedOpponent || nextPos === 31);
  const nextTurn: "creator" | "opponent" = earnedBonusTurn
    ? side
    : side === "creator"
    ? "opponent"
    : "creator";

  return {
    creatorTokens: creatorNext,
    opponentTokens: opponentNext,
    turn: nextTurn,
    diceValue: null,
    phase: "roll",
    lastAction: actionLog,
    winner,
    moveCount: (state.moveCount || 0) + 1,
  };
}

/**
 * 3D Royal-Blue Dice with White Pips matching the reference Ludo artwork
 */
function RoyalBlue3DDice({
  value,
  rolling,
  disabled,
  onClick,
  size = "lg",
}: {
  value: number;
  rolling: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: "md" | "lg";
}) {
  // Standard 3x3 pip grid positions (0..8) for dice values 1..6
  const pipMap: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const activePips = pipMap[value] || pipMap[6];
  const dims = size === "lg" ? "w-16 h-16 sm:w-20 sm:h-20" : "w-12 h-12";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Wait for your roll" : "Tap to Roll Dice!"}
      className={`group relative select-none transition-all duration-200 ${
        disabled ? "cursor-default" : "cursor-pointer hover:scale-110 active:scale-95"
      }`}
    >
      {/* 3D Perspective Cube Wrapper */}
      <div
        className={`${dims} rounded-[18px] relative transition-transform duration-300 ${
          rolling ? "animate-spin scale-110" : "-rotate-12 group-hover:-rotate-6"
        }`}
        style={{
          background:
            "linear-gradient(145deg, #6366f1 0%, #4338ca 45%, #1e1b4b 100%)",
          boxShadow:
            "0 12px 24px rgba(0,0,0,0.65), inset 0 3px 6px rgba(255,255,255,0.45), inset -4px -6px 10px rgba(15,23,42,0.8)",
          border: "2px solid rgba(165, 180, 252, 0.55)",
        }}
      >
        {/* Top Face White Pips (3x3 grid) */}
        <div className="w-full h-full p-2.5 sm:p-3 grid grid-cols-3 grid-rows-3 gap-1 place-items-center">
          {Array.from({ length: 9 }).map((_, idx) => {
            const hasPip = activePips.includes(idx);
            return (
              <span
                key={idx}
                className={`rounded-full transition-all ${
                  size === "lg" ? "w-2.5 h-2.5 sm:w-3 sm:h-3" : "w-2 h-2"
                } ${
                  hasPip
                    ? "bg-white shadow-[0_1px_3px_rgba(0,0,0,0.6),inset_0_-1px_2px_rgba(203,213,225,0.9)] scale-100"
                    : "opacity-0 scale-0"
                }`}
              />
            );
          })}
        </div>
      </div>
    </button>
  );
}

interface GhanaLudoBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: LudoState;
  onStateChange?: (nextState: LudoState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: LudoState) => void;
}

export function GhanaLudoBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
}: GhanaLudoBoardProps) {
  const [game, setGame] = useState<LudoState>(() =>
    initialState && Array.isArray(initialState.creatorTokens)
      ? initialState
      : INITIAL_LUDO_STATE
  );
  const [rolling, setRolling] = useState(false);
  const [lastRolledVisual, setLastRolledVisual] = useState<number>(6);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (
      initialState &&
      Array.isArray(initialState.creatorTokens) &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame(initialState);
      if (initialState.diceValue) setLastRolledVisual(initialState.diceValue);
    }
  }, [initialState, game.moveCount]);

  const isMyTurn = !game.winner && game.turn === mySide;

  const handleRollDice = useCallback(() => {
    if (game.winner || !isMyTurn || game.phase !== "roll" || rolling) return;
    setRolling(true);
    playSound("click");

    setTimeout(() => {
      const rolled = Math.floor(Math.random() * 6) + 1;
      setRolling(false);
      setLastRolledVisual(rolled);

      const myTokens = mySide === "creator" ? game.creatorTokens : game.opponentTokens;
      const movableIndices = myTokens
        .map((_, idx) => idx)
        .filter((idx) => canMoveLudoToken(myTokens, idx, rolled));

      if (movableIndices.length === 0) {
        const nextTurn: "creator" | "opponent" = mySide === "creator" ? "opponent" : "creator";
        const skippedState: LudoState = {
          ...game,
          diceValue: null,
          phase: "roll",
          turn: nextTurn,
          lastAction: `Rolled a ${rolled} — no valid token moves available. Turn passed!`,
          moveCount: (game.moveCount || 0) + 1,
        };
        setGame(skippedState);
        onStateChange?.(skippedState);
        return;
      }

      // If only 1 token can move (or all movable tokens are in yard), auto-move it for snappy gameplay
      const uniquePositions = new Set(movableIndices.map((i) => myTokens[i]));
      if (movableIndices.length === 1 || uniquePositions.size === 1) {
        const tempState: LudoState = { ...game, diceValue: rolled, phase: "move" };
        const autoMoved = applyLudoTokenMove(tempState, mySide, movableIndices[0]);
        if (autoMoved) {
          setGame(autoMoved);
          onStateChange?.(autoMoved);
          if (autoMoved.winner) {
            playSuccessSound();
            onMatchComplete?.(autoMoved.winner, autoMoved);
          }
          return;
        }
      }

      const moveState: LudoState = {
        ...game,
        diceValue: rolled,
        phase: "move",
        lastAction: `🎲 Rolled a ${rolled}! Tap one of your highlighted tokens on the board to move.`,
      };
      setGame(moveState);
      onStateChange?.(moveState);
    }, 450);
  }, [game, isMyTurn, rolling, mySide, onStateChange, onMatchComplete]);

  const handleSelectToken = useCallback(
    (tokenIdx: number) => {
      if (game.winner || !isMyTurn || game.phase !== "move") return;
      const nextState = applyLudoTokenMove(game, mySide, tokenIdx);
      if (!nextState) return;

      playSound("click");
      setGame(nextState);
      onStateChange?.(nextState);

      if (nextState.winner) {
        playSuccessSound();
        onMatchComplete?.(nextState.winner, nextState);
      }
    },
    [game, isMyTurn, mySide, onStateChange, onMatchComplete]
  );

  // AI Turn Engine
  useEffect(() => {
    if (
      (mode === "ai" || mode === "free_data") &&
      !game.winner &&
      game.turn === "opponent"
    ) {
      const timer = setTimeout(() => {
        const rolled = Math.floor(Math.random() * 6) + 1;
        setLastRolledVisual(rolled);
        const aiTokens = game.opponentTokens;
        const movable = aiTokens
          .map((_, idx) => idx)
          .filter((idx) => canMoveLudoToken(aiTokens, idx, rolled));

        if (movable.length === 0) {
          const passed: LudoState = {
            ...game,
            turn: "creator",
            diceValue: null,
            phase: "roll",
            lastAction: `${opponentName} rolled ${rolled} — no valid moves! Your turn.`,
            moveCount: (game.moveCount || 0) + 1,
          };
          setGame(passed);
          onStateChange?.(passed);
          return;
        }

        // Smart AI priority: 1) Kick human token, 2) Reach Home (31), 3) Exit yard on 6, 4) Advance furthest token
        const tempState: LudoState = { ...game, diceValue: rolled, phase: "move" };
        let chosenIdx = movable[0];
        let bestScore = -Infinity;

        for (const idx of movable) {
          const sim = applyLudoTokenMove(tempState, "opponent", idx);
          if (!sim) continue;
          let score = sim.opponentTokens[idx] * 2;
          if (sim.lastAction?.includes("KICK")) score += 100;
          if (sim.opponentTokens[idx] === 31) score += 80;
          if (aiTokens[idx] === -1 && rolled === 6) score += 45;
          if (score > bestScore) {
            bestScore = score;
            chosenIdx = idx;
          }
        }

        const nextState = applyLudoTokenMove(tempState, "opponent", chosenIdx);
        if (nextState) {
          playSound("click");
          setGame(nextState);
          onStateChange?.(nextState);
          if (nextState.winner) onMatchComplete?.(nextState.winner, nextState);
        }
      }, 900);

      return () => clearTimeout(timer);
    }
  }, [mode, game, opponentName, onStateChange, onMatchComplete]);

  const creatorHome = game.creatorTokens.filter((t) => t === 31).length;
  const opponentHome = game.opponentTokens.filter((t) => t === 31).length;
  const displayDiceVal = game.diceValue || lastRolledVisual || 6;

  // Helper to render any tokens sitting on a specific (row, col) cell of the 15x15 cross track
  const renderCellTokens = (r: number, c: number) => {
    const creatorHere: number[] = [];
    const opponentHere: number[] = [];

    game.creatorTokens.forEach((rel, idx) => {
      const coord = getTokenBoardCoord("creator", rel);
      if (coord && coord[0] === r && coord[1] === c) creatorHere.push(idx);
    });

    game.opponentTokens.forEach((rel, idx) => {
      const coord = getTokenBoardCoord("opponent", rel);
      if (coord && coord[0] === r && coord[1] === c) opponentHere.push(idx);
    });

    if (creatorHere.length === 0 && opponentHere.length === 0) return null;

    return (
      <div className="absolute inset-0 flex items-center justify-center gap-0.5 z-20 pointer-events-auto">
        {creatorHere.map((tIdx) => {
          const canClick =
            mySide === "creator" &&
            isMyTurn &&
            game.phase === "move" &&
            game.diceValue !== null &&
            canMoveLudoToken(game.creatorTokens, tIdx, game.diceValue);
          return (
            <button
              key={`c-${tIdx}`}
              type="button"
              disabled={!canClick}
              onClick={() => handleSelectToken(tIdx)}
              title={`Red Token #${tIdx + 1}`}
              className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-red-600 border-2 border-white shadow-[0_2px_6px_rgba(0,0,0,0.75)] flex items-center justify-center text-[8px] font-black text-white transition-transform ${
                canClick ? "ring-2 ring-amber-300 animate-bounce scale-125 cursor-pointer" : ""
              }`}
            >
              {tIdx + 1}
            </button>
          );
        })}
        {opponentHere.map((tIdx) => {
          const canClick =
            mySide === "opponent" &&
            isMyTurn &&
            game.phase === "move" &&
            game.diceValue !== null &&
            canMoveLudoToken(game.opponentTokens, tIdx, game.diceValue);
          return (
            <button
              key={`o-${tIdx}`}
              type="button"
              disabled={!canClick}
              onClick={() => handleSelectToken(tIdx)}
              title={`Yellow Token #${tIdx + 1}`}
              className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-amber-400 border-2 border-slate-950 shadow-[0_2px_6px_rgba(0,0,0,0.75)] flex items-center justify-center text-[8px] font-black text-slate-950 transition-transform ${
                canClick ? "ring-2 ring-white animate-bounce scale-125 cursor-pointer" : ""
              }`}
            >
              {tIdx + 1}
            </button>
          );
        })}
      </div>
    );
  };

  // Determines the authentic Ludo square color for a track cell (r, c)
  const getTrackCellStyle = (r: number, c: number) => {
    // Green Start & Green Home Stretch
    if ((r === 6 && c === 1) || (r === 7 && c >= 1 && c <= 5)) {
      return "bg-[#15803d] text-white border-slate-700/60";
    }
    // Yellow Start & Yellow Home Stretch
    if ((r === 1 && c === 8) || (c === 7 && r >= 1 && r <= 5)) {
      return "bg-[#eab308] text-slate-950 border-slate-700/60";
    }
    // Red Start & Red Home Stretch
    if ((r === 13 && c === 6) || (c === 7 && r >= 9 && r <= 13)) {
      return "bg-[#dc2626] text-white border-slate-700/60";
    }
    // Blue Start & Blue Home Stretch
    if ((r === 8 && c === 13) || (r === 7 && c >= 9 && c <= 13)) {
      return "bg-[#0284c7] text-white border-slate-700/60";
    }
    return "bg-[#eef6fb] text-slate-700 border-slate-400/80";
  };

  const isStarCell = (r: number, c: number) =>
    (r === 13 && c === 6) ||
    (r === 6 && c === 1) ||
    (r === 1 && c === 8) ||
    (r === 8 && c === 13);

  return (
    <div className="space-y-4">
      {/* Top Status & Rules Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/95 border border-indigo-500/30 shadow-lg">
        <div className="flex items-center gap-2.5">
          <img
            src="/ludo-challenge-icon.png"
            alt="Ghana Ludo"
            className="w-8 h-8 rounded-lg object-cover shadow-md border border-white/20"
          />
          <Badge className="bg-gradient-to-r from-green-600 via-yellow-500 to-red-600 text-white font-black text-xs px-3 py-1 shadow">
            🎲 GHANA LUDO ARENA
          </Badge>
          <span className="text-xs text-amber-200 font-semibold">
            First to race <strong>2 tokens HOME</strong> wins!
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowRules((v) => !v)}
          className="h-8 text-xs text-amber-300 hover:text-amber-200 gap-1"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          {showRules ? "Hide Rules" : "Ludo Rules"}
        </Button>
      </div>

      {showRules && (
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-amber-500/30 text-xs text-slate-200 space-y-1">
          <p className="font-black text-amber-400">🇬🇭 Ghana Ludo Official Rules:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Tap the <strong>3D Blue Dice</strong> in the center of the Ludo board (or the Roll button) on your turn.</li>
            <li>Roll a <strong>6</strong> to bring a new token out of your 2×2 Yard onto your Starting Square and earn a <strong>Bonus Roll</strong>!</li>
            <li>Land on an opponent&apos;s token outside ⭐ Safe Start squares to <strong>KICK</strong> it back to their Yard and earn a Bonus Roll!</li>
            <li>First player to bring <strong>2 tokens</strong> into the Center Home triangle wins the stake or Free Data reward!</li>
          </ul>
        </div>
      )}

      {/* Player Score & Turn Banner */}
      <div className="grid grid-cols-2 gap-3">
        {/* Creator (Red Base) */}
        <div
          className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-between ${
            game.turn === "creator" && !game.winner
              ? "bg-red-950/70 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
              : "bg-slate-900/70 border-white/10"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full bg-[#dc2626] ring-2 ring-white shrink-0" />
            <div className="truncate">
              <p className="text-[10px] font-black uppercase tracking-wider text-red-300">
                Red Camp {mySide === "creator" ? "(YOU)" : ""}
              </p>
              <p className="text-xs sm:text-sm font-black text-white truncate">{creatorName}</p>
            </div>
          </div>
          <Badge className="bg-red-500/20 text-red-200 border border-red-500/40 font-black shrink-0">
            🏠 {creatorHome}/2
          </Badge>
        </div>

        {/* Opponent (Yellow Base) */}
        <div
          className={`p-3 rounded-2xl border-2 transition-all flex items-center justify-between ${
            game.turn === "opponent" && !game.winner
              ? "bg-amber-950/70 border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.3)]"
              : "bg-slate-900/70 border-white/10"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-4 h-4 rounded-full bg-[#eab308] ring-2 ring-white shrink-0" />
            <div className="truncate">
              <p className="text-[10px] font-black uppercase tracking-wider text-yellow-300">
                Yellow Camp {mySide === "opponent" ? "(YOU)" : ""}
              </p>
              <p className="text-xs sm:text-sm font-black text-white truncate">{opponentName}</p>
            </div>
          </div>
          <Badge className="bg-yellow-500/20 text-yellow-200 border border-yellow-500/40 font-black shrink-0">
            🏠 {opponentHome}/2
          </Badge>
        </div>
      </div>

      {/* AUTHENTIC 15x15 4-CORNER LUDO BOARD WITH CENTER 3D ROYAL BLUE DICE */}
      <div className="relative mx-auto w-full max-w-[460px] aspect-square rounded-[28px] p-2 sm:p-3 bg-slate-950 border-4 border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
        <div
          className="w-full h-full rounded-[20px] overflow-hidden border-2 border-slate-800 grid relative bg-[#eef6fb]"
          style={{
            gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
            gridTemplateRows: "repeat(15, minmax(0, 1fr))",
          }}
        >
          {/* 1. TOP-LEFT GREEN YARD (Rows 1..6, Cols 1..6) */}
          <div
            style={{ gridColumn: "1 / span 6", gridRow: "1 / span 6" }}
            className="bg-[#15803d] p-2.5 sm:p-4 flex items-center justify-center border-r-2 border-b-2 border-slate-700/70"
          >
            <div className="w-full h-full bg-[#f8fafc] rounded-[22%] p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 sm:gap-3 place-items-center shadow-inner">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={`green-yard-${idx}`}
                  className="w-full h-full rounded-full bg-[#15803d] shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)] flex items-center justify-center"
                >
                  <span className="w-3/5 h-3/5 rounded-full bg-emerald-400/30 border border-white/40" />
                </div>
              ))}
            </div>
          </div>

          {/* 2. TOP-RIGHT YELLOW YARD — OPPONENT BASE (Rows 1..6, Cols 10..15) */}
          <div
            style={{ gridColumn: "10 / span 6", gridRow: "1 / span 6" }}
            className="bg-[#eab308] p-2.5 sm:p-4 flex items-center justify-center border-l-2 border-b-2 border-slate-700/70 relative"
          >
            <div className="w-full h-full bg-[#f8fafc] rounded-[22%] p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 sm:gap-3 place-items-center shadow-inner">
              {game.opponentTokens.map((pos, idx) => {
                const inYard = pos === -1;
                const canSpawn =
                  inYard &&
                  mySide === "opponent" &&
                  isMyTurn &&
                  game.phase === "move" &&
                  game.diceValue === 6;
                return (
                  <button
                    key={`yellow-yard-${idx}`}
                    type="button"
                    disabled={!canSpawn}
                    onClick={() => handleSelectToken(idx)}
                    className={`w-full h-full rounded-full bg-[#eab308] shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)] flex items-center justify-center relative transition-transform ${
                      canSpawn ? "ring-4 ring-indigo-600 animate-pulse scale-110 cursor-pointer" : ""
                    }`}
                  >
                    {inYard ? (
                      <span className="w-4/5 h-4/5 rounded-full bg-yellow-300 border-2 border-slate-900 shadow-md flex items-center justify-center text-[10px] font-black text-slate-950">
                        {idx + 1}
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-yellow-950/60">
                        {pos === 31 ? "🏠" : "OUT"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. BOTTOM-LEFT RED YARD — CREATOR BASE (Rows 10..15, Cols 1..6) */}
          <div
            style={{ gridColumn: "1 / span 6", gridRow: "10 / span 6" }}
            className="bg-[#dc2626] p-2.5 sm:p-4 flex items-center justify-center border-r-2 border-t-2 border-slate-700/70 relative"
          >
            <div className="w-full h-full bg-[#f8fafc] rounded-[22%] p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 sm:gap-3 place-items-center shadow-inner">
              {game.creatorTokens.map((pos, idx) => {
                const inYard = pos === -1;
                const canSpawn =
                  inYard &&
                  mySide === "creator" &&
                  isMyTurn &&
                  game.phase === "move" &&
                  game.diceValue === 6;
                return (
                  <button
                    key={`red-yard-${idx}`}
                    type="button"
                    disabled={!canSpawn}
                    onClick={() => handleSelectToken(idx)}
                    className={`w-full h-full rounded-full bg-[#dc2626] shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)] flex items-center justify-center relative transition-transform ${
                      canSpawn ? "ring-4 ring-yellow-300 animate-pulse scale-110 cursor-pointer" : ""
                    }`}
                  >
                    {inYard ? (
                      <span className="w-4/5 h-4/5 rounded-full bg-red-500 border-2 border-white shadow-md flex items-center justify-center text-[10px] font-black text-white">
                        {idx + 1}
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-white/80">
                        {pos === 31 ? "🏠" : "OUT"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. BOTTOM-RIGHT BLUE YARD (Rows 10..15, Cols 10..15) */}
          <div
            style={{ gridColumn: "10 / span 6", gridRow: "10 / span 6" }}
            className="bg-[#0284c7] p-2.5 sm:p-4 flex items-center justify-center border-l-2 border-t-2 border-slate-700/70"
          >
            <div className="w-full h-full bg-[#f8fafc] rounded-[22%] p-2 sm:p-3 grid grid-cols-2 grid-rows-2 gap-2 sm:gap-3 place-items-center shadow-inner">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={`blue-yard-${idx}`}
                  className="w-full h-full rounded-full bg-[#0284c7] shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)] flex items-center justify-center"
                >
                  <span className="w-3/5 h-3/5 rounded-full bg-sky-300/30 border border-white/40" />
                </div>
              ))}
            </div>
          </div>

          {/* 5. CENTER 3x3 HOME TRIANGLES (Rows 7..9, Cols 7..9) */}
          <div
            style={{ gridColumn: "7 / span 3", gridRow: "7 / span 3" }}
            className="relative border-2 border-slate-700/80 overflow-hidden"
          >
            <svg viewBox="0 0 100 100" className="w-full h-full block">
              {/* Top Yellow Triangle */}
              <polygon points="0,0 100,0 50,50" fill="#eab308" stroke="#334155" strokeWidth="1.5" />
              {/* Left Green Triangle */}
              <polygon points="0,0 0,100 50,50" fill="#15803d" stroke="#334155" strokeWidth="1.5" />
              {/* Right Blue Triangle */}
              <polygon points="100,0 100,100 50,50" fill="#0284c7" stroke="#334155" strokeWidth="1.5" />
              {/* Bottom Red Triangle */}
              <polygon points="0,100 100,100 50,50" fill="#dc2626" stroke="#334155" strokeWidth="1.5" />
            </svg>
          </div>

          {/* 6. RENDER ALL CROSS-TRACK CELLS (Top, Left, Right, Bottom Arms) */}
          {Array.from({ length: 15 }).map((_, r) =>
            Array.from({ length: 15 }).map((__, c) => {
              // Skip the 4 6x6 corner yards and the 3x3 center goal
              const inTopLeft = r < 6 && c < 6;
              const inTopRight = r < 6 && c >= 9;
              const inBottomLeft = r >= 9 && c < 6;
              const inBottomRight = r >= 9 && c >= 9;
              const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
              if (inTopLeft || inTopRight || inBottomLeft || inBottomRight || inCenter) {
                return null;
              }

              const cellStyle = getTrackCellStyle(r, c);
              const star = isStarCell(r, c);

              return (
                <div
                  key={`cell-${r}-${c}`}
                  style={{ gridColumn: c + 1, gridRow: r + 1 }}
                  className={`border-[0.5px] relative flex items-center justify-center select-none ${cellStyle}`}
                >
                  {star && (
                    <span className="text-[9px] sm:text-[11px] opacity-85 pointer-events-none">
                      ★
                    </span>
                  )}
                  {renderCellTokens(r, c)}
                </div>
              );
            })
          )}

          {/* 7. FLOATING CENTER 3D ROYAL-BLUE DICE OVERLAY (Matches Reference Image!) */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-30">
            <div className="pointer-events-auto flex flex-col items-center">
              <RoyalBlue3DDice
                value={displayDiceVal}
                rolling={rolling}
                disabled={!isMyTurn || game.phase !== "roll" || rolling || Boolean(game.winner)}
                onClick={handleRollDice}
                size="lg"
              />
              {isMyTurn && game.phase === "roll" && !game.winner && (
                <span className="mt-1.5 px-2.5 py-0.5 rounded-full bg-indigo-950/95 border border-indigo-400/60 text-[10px] font-black text-white shadow-lg animate-bounce">
                  TAP DICE TO ROLL
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action Control Bar & Quick Token Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/95 border border-white/10 shadow-lg">
        <div className="space-y-1">
          <p className="text-xs sm:text-sm font-black text-white">
            {game.winner
              ? game.winner === mySide
                ? "🏆 VICTORY! You won the Ghana Ludo Challenge!"
                : `🏅 ${game.winner === "creator" ? creatorName : opponentName} won the Ludo match!`
              : isMyTurn
              ? game.phase === "roll"
                ? "🟢 YOUR TURN — Tap the 3D Blue Dice on the board!"
                : `🎲 Rolled ${game.diceValue}! Tap a highlighted token on the board or below.`
              : `⏳ ${game.turn === "creator" ? creatorName : opponentName} is rolling...`}
          </p>
          <p className="text-xs text-amber-300/90 font-medium">{game.lastAction}</p>
        </div>

        <div className="flex items-center gap-3">
          <RoyalBlue3DDice
            value={displayDiceVal}
            rolling={rolling}
            disabled={!isMyTurn || game.phase !== "roll" || rolling || Boolean(game.winner)}
            onClick={handleRollDice}
            size="md"
          />
          <Button
            onClick={handleRollDice}
            disabled={!isMyTurn || game.phase !== "roll" || rolling || Boolean(game.winner)}
            className="h-12 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-500 hover:from-indigo-500 hover:to-blue-500 text-white font-black text-sm gap-2 shadow-lg border border-indigo-400/40"
          >
            {rolling ? "Rolling..." : "Roll 3D Dice"}
          </Button>
        </div>
      </div>

      {/* Quick Token Controls for Mobile Convenience */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {(mySide === "creator" ? game.creatorTokens : game.opponentTokens).map((pos, idx) => {
          const myTokens = mySide === "creator" ? game.creatorTokens : game.opponentTokens;
          const selectable =
            isMyTurn &&
            game.phase === "move" &&
            game.diceValue !== null &&
            canMoveLudoToken(myTokens, idx, game.diceValue);
          const pct = pos === -1 ? 0 : Math.min(100, Math.round((pos / 31) * 100));
          const absSq = toAbsoluteSquare(mySide, pos);
          const isSafe = absSq !== null && SAFE_ABSOLUTE_SQUARES.has(absSq);

          return (
            <button
              key={`quick-token-${idx}`}
              type="button"
              disabled={!selectable}
              onClick={() => handleSelectToken(idx)}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectable
                  ? "bg-indigo-600/25 border-amber-400 ring-2 ring-amber-400/50 hover:scale-[1.03] cursor-pointer"
                  : pos === 31
                  ? "bg-emerald-950/40 border-emerald-500/40"
                  : "bg-slate-900/80 border-white/10"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-black text-white flex items-center gap-1">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      mySide === "creator" ? "bg-red-500" : "bg-yellow-400"
                    }`}
                  />
                  Token #{idx + 1}
                  {isSafe && (
                    <span title="On Safe Star Square">
                      <Shield className="w-3 h-3 text-amber-400" />
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-mono font-bold text-amber-300">
                  {pos === -1 ? "Yard" : pos === 31 ? "🏠 HOME" : `${pos}/31`}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-black/50 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    mySide === "creator"
                      ? "bg-gradient-to-r from-red-500 to-amber-400"
                      : "bg-gradient-to-r from-yellow-400 to-emerald-400"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {selectable && (
                <p className="text-[10px] font-black text-amber-300 mt-1 animate-pulse">
                  ⚡ Tap to move (+{game.diceValue})
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
