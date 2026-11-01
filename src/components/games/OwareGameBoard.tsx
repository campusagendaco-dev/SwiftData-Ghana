import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Trophy, RotateCcw, Volume2, VolumeX, HelpCircle } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";

export interface OwareState {
  pits: number[]; // indices 0..5 = Creator (South, L->R), indices 6..11 = Opponent (North, R->L counter-clockwise)
  scores: { creator: number; opponent: number };
  turn: "creator" | "opponent";
  lastMove?: { pit: number; captured: number; player: "creator" | "opponent" } | null;
  winner?: "creator" | "opponent" | "draw" | null;
  moveCount: number;
}

export const INITIAL_OWARE_STATE: OwareState = {
  pits: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  scores: { creator: 0, opponent: 0 },
  turn: "creator",
  lastMove: null,
  winner: null,
  moveCount: 0,
};

/** Pure Abapa Oware move simulator (used by both human moves and Minimax AI) */
export function simulateOwareMove(
  state: OwareState,
  pitIndex: number,
  player: "creator" | "opponent"
): OwareState | null {
  if (state.winner) return null;
  if (player === "creator" && (pitIndex < 0 || pitIndex > 5)) return null;
  if (player === "opponent" && (pitIndex < 6 || pitIndex > 11)) return null;

  const seedsToSow = state.pits[pitIndex];
  if (!seedsToSow || seedsToSow <= 0) return null;

  const nextPits = [...state.pits];
  nextPits[pitIndex] = 0;

  let currentPit = pitIndex;
  let remaining = seedsToSow;

  while (remaining > 0) {
    currentPit = (currentPit + 1) % 12;
    // Abapa rule: skip the starting pit if sowing 12 or more seeds
    if (currentPit === pitIndex) continue;
    nextPits[currentPit] += 1;
    remaining -= 1;
  }

  // Check capture in opponent's row (2 or 3 seeds)
  const isOpponentTerritory = (idx: number) =>
    player === "creator" ? idx >= 6 && idx <= 11 : idx >= 0 && idx <= 5;

  let captured = 0;
  const tempPits = [...nextPits];
  let captureCursor = currentPit;

  while (
    isOpponentTerritory(captureCursor) &&
    (tempPits[captureCursor] === 2 || tempPits[captureCursor] === 3)
  ) {
    captured += tempPits[captureCursor];
    tempPits[captureCursor] = 0;
    captureCursor = (captureCursor + 11) % 12;
  }

  // Grand Slam rule: if capturing would leave opponent with 0 seeds, capture is forfeited unless no other move feeds them
  const oppStart = player === "creator" ? 6 : 0;
  const oppEnd = player === "creator" ? 11 : 5;
  const oppRemainingAfterCapture = tempPits
    .slice(oppStart, oppEnd + 1)
    .reduce((acc, v) => acc + v, 0);

  let finalPits = nextPits;
  if (captured > 0 && oppRemainingAfterCapture > 0) {
    finalPits = tempPits;
  } else if (captured > 0 && oppRemainingAfterCapture === 0) {
    // Grand Slam forfeit: seeds remain on board uncaptured
    captured = 0;
  }

  const nextScores = {
    creator: state.scores.creator + (player === "creator" ? captured : 0),
    opponent: state.scores.opponent + (player === "opponent" ? captured : 0),
  };

  const nextTurn: "creator" | "opponent" = player === "creator" ? "opponent" : "creator";
  const nextTurnStart = nextTurn === "creator" ? 0 : 6;
  const nextTurnEnd = nextTurn === "creator" ? 5 : 11;
  const nextTurnSeeds = finalPits
    .slice(nextTurnStart, nextTurnEnd + 1)
    .reduce((a, b) => a + b, 0);

  let winner: "creator" | "opponent" | "draw" | null = null;
  const totalMoveCount = (state.moveCount || 0) + 1;

  // Check win condition (25+ seeds) or starvation / 80-move limit
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
    pits: finalPits,
    scores: nextScores,
    turn: nextTurn,
    lastMove: { pit: pitIndex, captured, player },
    winner,
    moveCount: totalMoveCount,
  };
}

/** Choose best AI move using 3-ply Minimax lookahead */
function pickBestAiMove(state: OwareState): number {
  const validPits: number[] = [];
  for (let i = 6; i <= 11; i++) {
    if (state.pits[i] > 0) validPits.push(i);
  }
  if (validPits.length === 0) return -1;

  let bestPit = validPits[0];
  let bestScore = -Infinity;

  for (const pit of validPits) {
    const sim1 = simulateOwareMove(state, pit, "opponent");
    if (!sim1) continue;

    // Evaluate AI advantage + worst human response
    let minReplyScore = Infinity;
    let hasHumanReply = false;
    for (let h = 0; h <= 5; h++) {
      if (sim1.pits[h] <= 0) continue;
      hasHumanReply = true;
      const sim2 = simulateOwareMove(sim1, h, "creator");
      if (!sim2) continue;
      const evalScore =
        (sim2.scores.opponent - sim2.scores.creator) * 4 +
        sim2.pits.slice(6, 12).reduce((a, b) => a + b, 0) -
        sim2.pits.slice(0, 6).reduce((a, b) => a + b, 0);
      if (evalScore < minReplyScore) minReplyScore = evalScore;
    }

    const finalScore = hasHumanReply
      ? minReplyScore
      : (sim1.scores.opponent - sim1.scores.creator) * 10;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestPit = pit;
    }
  }

  return bestPit;
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
      ? initialState
      : INITIAL_OWARE_STATE
  );
  const [hoveredPit, setHoveredPit] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [muted, setMuted] = useState(false);

  // Keep synced with external realtime board_state updates in P2P mode
  useEffect(() => {
    if (
      initialState &&
      Array.isArray(initialState.pits) &&
      initialState.pits.length === 12 &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame(initialState);
    }
  }, [initialState, game.moveCount]);

  const handlePitClick = useCallback(
    (pitIndex: number) => {
      if (game.winner) return;
      if (game.turn !== mySide) return;

      const nextState = simulateOwareMove(game, pitIndex, mySide);
      if (!nextState) return;

      if (!muted) {
        if ((nextState.lastMove?.captured || 0) > 0) playSuccessSound();
        else playSound("click");
      }

      setGame(nextState);
      onStateChange?.(nextState);

      if (nextState.winner) {
        onMatchComplete?.(nextState.winner, nextState);
      }
    },
    [game, mySide, muted, onStateChange, onMatchComplete]
  );

  // Trigger AI move when playing vs AI / Free Data mode
  useEffect(() => {
    if ((mode === "ai" || mode === "free_data") && !game.winner && game.turn === "opponent") {
      const timer = setTimeout(() => {
        const aiPit = pickBestAiMove(game);
        if (aiPit === -1) return;
        const nextState = simulateOwareMove(game, aiPit, "opponent");
        if (!nextState) return;

        if (!muted) playSound("click");
        setGame(nextState);
        onStateChange?.(nextState);

        if (nextState.winner) {
          onMatchComplete?.(nextState.winner, nextState);
        }
      }, 900);

      return () => clearTimeout(timer);
    }
  }, [mode, game, muted, onStateChange, onMatchComplete]);

  // Top row (North: Opponent pits 11 down to 6 left-to-right so counter-clockwise flow is visually accurate)
  const northIndices = [11, 10, 9, 8, 7, 6];
  // Bottom row (South: Creator pits 0 up to 5 left-to-right)
  const southIndices = [0, 1, 2, 3, 4, 5];

  const isMyTurn = !game.winner && game.turn === mySide;

  return (
    <div className="space-y-4">
      {/* Top Status & Score Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30">
        <div className="flex items-center gap-3">
          <Badge className="bg-amber-500 text-slate-950 font-black text-xs px-3 py-1">
            🪨 OWARE ABAPA
          </Badge>
          <span className="text-xs text-amber-200/90 font-semibold">
            First to <strong>25 seeds</strong> wins!
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRules((v) => !v)}
            className="h-8 text-xs text-amber-300 hover:text-amber-200 gap-1"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            {showRules ? "Hide Rules" : "Abapa Rules"}
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
        <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/30 text-xs text-amber-100/90 space-y-1.5">
          <p className="font-black text-amber-400">🇬🇭 Traditional Ghanaian Oware (Abapa Rules):</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Click any of your glowing pits to pick up all seeds and sow them <strong>counter-clockwise</strong> one by one.</li>
            <li>If your <strong>last seed</strong> lands in your opponent&apos;s row and makes that pit have <strong>2 or 3 seeds</strong>, you capture them into your Kulo storehouse!</li>
            <li>Consecutive preceding opponent pits with 2 or 3 seeds are also captured in a combo chain.</li>
            <li>Capture <strong>25 or more seeds</strong> first to win the challenge pot or Free Data Bundle!</li>
          </ul>
        </div>
      )}

      {/* Turn Banner */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isMyTurn ? "bg-emerald-400 animate-ping" : "bg-amber-400"
            }`}
          />
          <span className="text-xs sm:text-sm font-black text-white">
            {game.winner
              ? game.winner === "draw"
                ? "🤝 Match Ended in a Draw!"
                : game.winner === mySide
                ? "🏆 YOU WON THE OWARE CHALLENGE!"
                : `🏅 ${game.winner === "creator" ? creatorName : opponentName} Won!`
              : isMyTurn
              ? "🟢 YOUR TURN — Tap one of your pits to sow seeds!"
              : `⏳ Waiting for ${game.turn === "creator" ? creatorName : opponentName} to play...`}
          </span>
        </div>

        {game.lastMove && (
          <Badge variant="outline" className="text-[11px] border-amber-500/40 text-amber-300 bg-amber-500/10">
            {game.lastMove.captured > 0
              ? `🔥 Captured +${game.lastMove.captured} seeds!`
              : `Sowed Pit #${game.lastMove.pit + 1}`}
          </Badge>
        )}
      </div>

      {/* Carved Royal Mahogany Oware Board */}
      <div className="relative p-4 sm:p-6 rounded-3xl bg-gradient-to-b from-[#4a2511] via-[#381b0c] to-[#261107] border-4 border-[#6e3b1e] shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-8 gap-4 items-center">
          {/* Opponent Kulo Storehouse (Left) */}
          <div className="flex lg:flex-col items-center justify-between lg:justify-center p-4 rounded-2xl bg-[#1f0d05]/90 border-2 border-amber-600/40 shadow-inner min-h-[110px] lg:min-h-[240px]">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400/80 truncate max-w-[110px]">
                {opponentName}
              </p>
              <p className="text-3xl font-black text-amber-300 font-mono mt-1">
                {game.scores.opponent}
              </p>
              <span className="text-[10px] text-amber-200/60">Captured Seeds</span>
            </div>
          </div>

          {/* 12 Pits (2 Rows of 6) */}
          <div className="lg:col-span-6 space-y-5">
            {/* North Row (Opponent Pits 11..6) */}
            <div>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70">
                  {opponentName}&apos;s Row (North)
                </span>
                {mySide === "opponent" && isMyTurn && (
                  <span className="text-[10px] font-black text-emerald-400">Tap a pit below ↓</span>
                )}
              </div>
              <div className="grid grid-cols-6 gap-2 sm:gap-3">
                {northIndices.map((pitIdx) => {
                  const count = game.pits[pitIdx];
                  const canClick = mySide === "opponent" && isMyTurn && count > 0;
                  const isLastMoved = game.lastMove?.pit === pitIdx;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      disabled={!canClick}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-2 transition-all border-2 shadow-inner ${
                        canClick
                          ? "bg-[#1d0c04] border-emerald-400/70 hover:scale-105 hover:border-emerald-300 cursor-pointer ring-2 ring-emerald-500/20"
                          : isLastMoved
                          ? "bg-[#2b1408] border-amber-400/70"
                          : "bg-[#1a0b04] border-[#5c3018] opacity-90 cursor-default"
                      }`}
                    >
                      {/* Visual Seeds inside Pit */}
                      <div className="flex flex-wrap items-center justify-center gap-1 max-w-[80%]">
                        {Array.from({ length: Math.min(count, 9) }).map((_, sIdx) => (
                          <span
                            key={sIdx}
                            className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 shadow-sm border border-amber-900/50"
                          />
                        ))}
                      </div>
                      <span className="mt-1 px-2 py-0.5 rounded-full bg-black/70 text-amber-200 font-mono font-black text-xs sm:text-sm">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Center Carved Divider */}
            <div className="h-1.5 rounded-full bg-gradient-to-r from-transparent via-amber-600/40 to-transparent" />

            {/* South Row (Creator Pits 0..5) */}
            <div>
              <div className="grid grid-cols-6 gap-2 sm:gap-3">
                {southIndices.map((pitIdx) => {
                  const count = game.pits[pitIdx];
                  const canClick = mySide === "creator" && isMyTurn && count > 0;
                  const isLastMoved = game.lastMove?.pit === pitIdx;

                  return (
                    <button
                      key={pitIdx}
                      type="button"
                      disabled={!canClick}
                      onMouseEnter={() => setHoveredPit(pitIdx)}
                      onMouseLeave={() => setHoveredPit(null)}
                      onClick={() => handlePitClick(pitIdx)}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-2 transition-all border-2 shadow-inner ${
                        canClick
                          ? "bg-[#1d0c04] border-emerald-400/80 hover:scale-105 hover:border-emerald-300 cursor-pointer ring-2 ring-emerald-500/25"
                          : isLastMoved
                          ? "bg-[#2b1408] border-amber-400/70"
                          : "bg-[#1a0b04] border-[#5c3018] opacity-90 cursor-default"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-center gap-1 max-w-[80%]">
                        {Array.from({ length: Math.min(count, 9) }).map((_, sIdx) => (
                          <span
                            key={sIdx}
                            className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 shadow-sm border border-amber-900/50"
                          />
                        ))}
                      </div>
                      <span className="mt-1 px-2 py-0.5 rounded-full bg-black/70 text-emerald-300 font-mono font-black text-xs sm:text-sm">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-1.5 px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
                  {creatorName}&apos;s Row (South)
                </span>
                {mySide === "creator" && isMyTurn && (
                  <span className="text-[10px] font-black text-emerald-400 animate-pulse">
                    ↑ Tap any pit with seeds to sow
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Creator Kulo Storehouse (Right) */}
          <div className="flex lg:flex-col items-center justify-between lg:justify-center p-4 rounded-2xl bg-[#1f0d05]/90 border-2 border-emerald-500/40 shadow-inner min-h-[110px] lg:min-h-[240px]">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-400 truncate max-w-[110px]">
                {creatorName}
              </p>
              <p className="text-3xl font-black text-emerald-300 font-mono mt-1">
                {game.scores.creator}
              </p>
              <span className="text-[10px] text-emerald-200/60">Captured Seeds</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

