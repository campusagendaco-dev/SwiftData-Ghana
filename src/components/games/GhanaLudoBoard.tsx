import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dices, Shield, Zap, HelpCircle } from "lucide-react";
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
  lastAction: "Roll the dice to begin the Ghana Ludo showdown!",
  winner: null,
  moveCount: 0,
};

const SAFE_ABSOLUTE_SQUARES = new Set([0, 7, 14, 21]);

function toAbsoluteSquare(side: "creator" | "opponent", relStep: number): number | null {
  if (relStep < 0 || relStep > 27) return null;
  const offset = side === "creator" ? 0 : 14;
  return (relStep + offset) % 28;
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
      ? `${side === "creator" ? "Red" : "Green"} brought Token #${tokenIdx + 1} onto the board!`
      : `${side === "creator" ? "Red" : "Green"} advanced Token #${tokenIdx + 1} by ${dice}.`;

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
          actionLog = `💥 KICK! ${side === "creator" ? "Red" : "Green"} kicked opponent's Token #${i + 1} back to base! Bonus Roll!`;
        }
      }
    }
  }

  if (nextPos === 31) {
    actionLog = `🏠 HOME! ${side === "creator" ? "Red" : "Green"} brought Token #${tokenIdx + 1} safely home!`;
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
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (
      initialState &&
      Array.isArray(initialState.creatorTokens) &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame(initialState);
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

      // If only 1 token can move, auto-move it for snappy gameplay!
      if (movableIndices.length === 1) {
        const tempState: LudoState = { ...game, diceValue: rolled, phase: "move" };
        const moved = applyLudoTokenMove(tempState, mySide, movableIndices[0]);
        if (moved) {
          if (moved.lastAction?.includes("KICK") || moved.lastAction?.includes("HOME")) {
            playSuccessSound();
          }
          setGame(moved);
          onStateChange?.(moved);
          if (moved.winner) onMatchComplete?.(moved.winner, moved);
          return;
        }
      }

      const rolledState: LudoState = {
        ...game,
        diceValue: rolled,
        phase: "move",
        lastAction: `Rolled a ${rolled}! Tap one of your highlighted tokens to move.`,
        moveCount: (game.moveCount || 0) + 1,
      };
      setGame(rolledState);
      onStateChange?.(rolledState);
    }, 380);
  }, [game, isMyTurn, rolling, mySide, onStateChange, onMatchComplete]);

  const handleSelectToken = (tokenIdx: number) => {
    if (!isMyTurn || game.phase !== "move" || !game.diceValue) return;
    const moved = applyLudoTokenMove(game, mySide, tokenIdx);
    if (!moved) return;

    if (moved.lastAction?.includes("KICK") || moved.lastAction?.includes("HOME")) {
      playSuccessSound();
    } else {
      playSound("click");
    }

    setGame(moved);
    onStateChange?.(moved);
    if (moved.winner) onMatchComplete?.(moved.winner, moved);
  };

  // AI Turn Execution
  useEffect(() => {
    if ((mode === "ai" || mode === "free_data") && !game.winner && game.turn === "opponent") {
      const timer = setTimeout(() => {
        const rolled = Math.floor(Math.random() * 6) + 1;
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
            lastAction: `${opponentName} rolled ${rolled} (no legal move). Your turn!`,
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
      }, 950);

      return () => clearTimeout(timer);
    }
  }, [mode, game, opponentName, onStateChange, onMatchComplete]);

  const creatorHome = game.creatorTokens.filter((t) => t === 31).length;
  const opponentHome = game.opponentTokens.filter((t) => t === 31).length;

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-red-950/40 border border-red-500/30">
        <div className="flex items-center gap-2.5">
          <Badge className="bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 text-white font-black text-xs px-3 py-1">
            🎲 GHANA LUDO (KICK EDITION)
          </Badge>
          <span className="text-xs text-amber-200 font-semibold">
            First to bring <strong>2 tokens HOME</strong> wins!
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
          <p className="font-black text-amber-400">🇬🇭 Ghana Ludo Fast-Match Rules:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Each player starts with 1 active token on their starting Star and 3 tokens in the Yard.</li>
            <li>Roll a <strong>6</strong> to bring a new token out of the Yard and earn a <strong>Bonus Roll</strong>!</li>
            <li>Land on an opponent&apos;s token (outside ⭐ Safe Stars) to <strong>KICK</strong> it back to their Yard and earn a Bonus Roll!</li>
            <li>First player to race <strong>2 tokens</strong> to step 31 (HOME) wins the challenge!</li>
          </ul>
        </div>
      )}

      {/* Action & Dice Control Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/90 border border-white/10">
        <div className="space-y-1">
          <p className="text-xs sm:text-sm font-black text-white">
            {game.winner
              ? game.winner === mySide
                ? "🏆 VICTORY! You won the Ghana Ludo Challenge!"
                : `🏅 ${game.winner === "creator" ? creatorName : opponentName} won the Ludo match!`
              : isMyTurn
              ? game.phase === "roll"
                ? "🟢 YOUR TURN — Tap 'Roll Dice' below!"
                : `🎲 You rolled ${game.diceValue}! Tap a highlighted token below to advance.`
              : `⏳ ${game.turn === "creator" ? creatorName : opponentName} is rolling...`}
          </p>
          <p className="text-xs text-amber-300/90 font-medium">{game.lastAction}</p>
        </div>

        <div className="flex items-center gap-3">
          {game.diceValue && (
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 font-black text-2xl flex items-center justify-center shadow-lg border-2 border-white">
              {game.diceValue}
            </div>
          )}
          <Button
            onClick={handleRollDice}
            disabled={!isMyTurn || game.phase !== "roll" || rolling || Boolean(game.winner)}
            className="h-12 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-sm gap-2 shadow-lg"
          >
            <Dices className={`w-5 h-5 ${rolling ? "animate-spin" : ""}`} />
            {rolling ? "Rolling..." : "Roll Dice"}
          </Button>
        </div>
      </div>

      {/* Interactive Dual-Camp Ludo Track & Token Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Creator Camp (Red / Gold) */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-950/60 via-slate-950 to-amber-950/30 border-2 border-rose-500/40 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-400">
                🔴 Red Star Camp (Creator)
              </span>
              <h4 className="text-sm font-black text-white">{creatorName}</h4>
            </div>
            <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black">
              🏠 {creatorHome} / 2 Home
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {game.creatorTokens.map((pos, idx) => {
              const selectable =
                mySide === "creator" &&
                isMyTurn &&
                game.phase === "move" &&
                game.diceValue !== null &&
                canMoveLudoToken(game.creatorTokens, idx, game.diceValue);
              const pct = pos === -1 ? 0 : Math.min(100, Math.round((pos / 31) * 100));
              const absSq = toAbsoluteSquare("creator", pos);
              const isSafe = absSq !== null && SAFE_ABSOLUTE_SQUARES.has(absSq);

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!selectable}
                  onClick={() => handleSelectToken(idx)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectable
                      ? "bg-rose-500/25 border-amber-400 ring-2 ring-amber-400/40 hover:scale-[1.03] cursor-pointer"
                      : pos === 31
                      ? "bg-emerald-950/40 border-emerald-500/40"
                      : "bg-slate-900/70 border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-black text-white flex items-center gap-1">
                      🔴 Token #{idx + 1}
                      {isSafe && (
                        <span title="On Safe Star Square">
                          <Shield className="w-3 h-3 text-amber-400" />
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-rose-300">
                      {pos === -1 ? "In Yard" : pos === 31 ? "🏠 HOME" : `Step ${pos}/31`}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 to-amber-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {selectable && (
                    <p className="text-[10px] font-black text-amber-300 mt-1.5 animate-pulse">
                      ⚡ Tap to advance (+{game.diceValue})
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Opponent Camp (Green / Emerald) */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-950/60 via-slate-950 to-teal-950/30 border-2 border-emerald-500/40 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                🟢 Green Star Camp (Opponent)
              </span>
              <h4 className="text-sm font-black text-white">{opponentName}</h4>
            </div>
            <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black">
              🏠 {opponentHome} / 2 Home
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {game.opponentTokens.map((pos, idx) => {
              const selectable =
                mySide === "opponent" &&
                isMyTurn &&
                game.phase === "move" &&
                game.diceValue !== null &&
                canMoveLudoToken(game.opponentTokens, idx, game.diceValue);
              const pct = pos === -1 ? 0 : Math.min(100, Math.round((pos / 31) * 100));
              const absSq = toAbsoluteSquare("opponent", pos);
              const isSafe = absSq !== null && SAFE_ABSOLUTE_SQUARES.has(absSq);

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!selectable}
                  onClick={() => handleSelectToken(idx)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectable
                      ? "bg-emerald-500/25 border-amber-400 ring-2 ring-amber-400/40 hover:scale-[1.03] cursor-pointer"
                      : pos === 31
                      ? "bg-emerald-950/40 border-emerald-500/40"
                      : "bg-slate-900/70 border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-black text-white flex items-center gap-1">
                      🟢 Token #{idx + 1}
                      {isSafe && (
                        <span title="On Safe Star Square">
                          <Shield className="w-3 h-3 text-amber-400" />
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-emerald-300">
                      {pos === -1 ? "In Yard" : pos === 31 ? "🏠 HOME" : `Step ${pos}/31`}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {selectable && (
                    <p className="text-[10px] font-black text-amber-300 mt-1.5 animate-pulse">
                      ⚡ Tap to advance (+{game.diceValue})
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Visual 28-Square Perimeter Loop Map */}
      <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">
            Live 28-Square Ludo Perimeter Track (⭐ = Safe Star Square)
          </span>
          <span className="text-[10px] text-amber-400 font-bold">
            Landing on an opponent outside ⭐ kicks them back to Yard!
          </span>
        </div>
        <div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5">
          {Array.from({ length: 28 }).map((_, absIdx) => {
            const isSafe = SAFE_ABSOLUTE_SQUARES.has(absIdx);
            const hasCreator = game.creatorTokens.some(
              (rel) => toAbsoluteSquare("creator", rel) === absIdx
            );
            const hasOpponent = game.opponentTokens.some(
              (rel) => toAbsoluteSquare("opponent", rel) === absIdx
            );

            return (
              <div
                key={absIdx}
                className={`h-9 rounded-lg border flex flex-col items-center justify-center text-[10px] font-mono relative ${
                  isSafe
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                    : "bg-slate-900 border-white/10 text-slate-400"
                }`}
              >
                <span className="text-[8px] opacity-60">{isSafe ? "⭐" : absIdx + 1}</span>
                <div className="flex items-center gap-0.5">
                  {hasCreator && <span className="w-2.5 h-2.5 rounded-full bg-rose-500 ring-1 ring-white" />}
                  {hasOpponent && <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-1 ring-white" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
