import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Volume2, VolumeX, HelpCircle } from "lucide-react";
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
            className="absolute w-3.5 h-3 sm:w-4 sm:h-3.5 rounded-[52%_48%_48%_52%] shadow-[0_3px_5px_rgba(0,0,0,0.75),inset_0_1px_2px_rgba(255,255,255,0.45)] border border-black/30"
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
      {/* Top Hinge Leaf Screws */}
      <div className="flex items-center justify-between px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#2b1806] shadow-inner border border-amber-300/40" />
      </div>
      {/* Center Hinge Knuckle Barrel */}
      <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-[#5a3209] via-[#f7d894] to-[#5a3209] border-y border-black/50" />
      {/* Bottom Hinge Leaf Screws */}
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

  // Shared Terracotta Carved Bowl styling matching the reference photo
  const terracottaBowlStyle = {
    background:
      "radial-gradient(circle at 36% 30%, #e06d34 0%, #c64f18 48%, #8e2e07 82%, #4a1502 100%)",
    boxShadow:
      "inset 0 8px 16px rgba(0,0,0,0.75), inset 0 -3px 8px rgba(251,146,60,0.28), 0 2px 6px rgba(0,0,0,0.9)",
  };

  return (
    <div className="space-y-4">
      {/* Top Status & Score Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900/95 border border-amber-500/30 shadow-lg">
        <div className="flex items-center gap-3">
          <img
            src="/oware-challenge-icon.jpg"
            alt="Ghanaian Oware Board"
            className="w-8 h-8 rounded-lg object-cover shadow-md border border-amber-500/40"
          />
          <Badge className="bg-gradient-to-r from-orange-600 to-amber-500 text-white font-black text-xs px-3 py-1">
            🪨 OWARE ABAPA ARENA
          </Badge>
          <span className="text-xs text-amber-200/90 font-semibold">
            First to capture <strong>25 nickernut seeds</strong> wins!
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
            <li>Tap any of your carved terracotta bowls on your plank to scoop up all nickernut seeds and sow them <strong>counter-clockwise</strong> one by one.</li>
            <li>If your <strong>last seed</strong> lands in your opponent&apos;s row and brings that bowl to <strong>2 or 3 seeds</strong>, you capture them into your Kulo storehouse!</li>
            <li>Consecutive preceding opponent bowls with 2 or 3 seeds are also captured in a combo chain.</li>
            <li>Capture <strong>25 or more seeds</strong> first to win the challenge pot or Free Data Bundle!</li>
          </ul>
        </div>
      )}

      {/* Turn Banner */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-900/90 border border-white/10">
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
              ? "🟢 YOUR TURN — Tap one of your terracotta bowls to sow seeds!"
              : `⏳ Waiting for ${game.turn === "creator" ? creatorName : opponentName} to play...`}
          </span>
        </div>

        {game.lastMove && (
          <Badge variant="outline" className="text-[11px] border-amber-500/40 text-amber-300 bg-amber-500/10">
            {game.lastMove.captured > 0
              ? `🔥 Captured +${game.lastMove.captured} seeds!`
              : `Sowed Bowl #${game.lastMove.pit + 1}`}
          </Badge>
        )}
      </div>

      {/* AUTHENTIC HINGED MATTE-BLACK EBONY & CARVED TERRACOTTA OWARE BOARD */}
      <div className="relative p-3 sm:p-5 rounded-[36px] bg-slate-950/90 border border-white/10 shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-8 gap-4 items-center">
          {/* Opponent Kulo Storehouse (Left Ebony Bowl) */}
          <div
            className="flex lg:flex-col items-center justify-between lg:justify-center p-3.5 rounded-[36px] border-2 border-[#35373d] shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[115px] lg:min-h-[270px]"
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-center mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-orange-300 truncate max-w-[115px]">
                {opponentName}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-white font-mono">
                {game.scores.opponent}
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center"
              style={terracottaBowlStyle}
            >
              <NickernutSeedCluster count={game.scores.opponent} pitSeedOffset={20} />
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
                  {opponentName}&apos;s Plank (North Row)
                </span>
                {mySide === "opponent" && isMyTurn && (
                  <span className="text-[10px] font-black text-emerald-400 animate-pulse">
                    Tap a bowl below ↓
                  </span>
                )}
              </div>

              <div className="grid grid-cols-6 gap-2 sm:gap-3.5">
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
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all border-[3px] ${
                        canClick
                          ? "border-emerald-400 hover:scale-105 cursor-pointer ring-4 ring-emerald-500/25"
                          : isLastMoved
                          ? "border-amber-300 ring-2 ring-amber-400/40"
                          : "border-[#2d1206] cursor-default"
                      }`}
                    >
                      <NickernutSeedCluster count={count} pitSeedOffset={pitIdx * 3} />

                      {/* Seed Count Badge */}
                      <span
                        className={`absolute -bottom-1.5 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black font-mono shadow-md border ${
                          count > 0
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
              <span className="px-3 py-0.5 rounded-full bg-[#141518] border border-white/10 text-[9px] font-bold uppercase tracking-widest text-amber-400/70">
                ↺ Counter-Clockwise Abapa Flow ↺
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
                      style={terracottaBowlStyle}
                      className={`group relative aspect-square rounded-full flex flex-col items-center justify-center p-1.5 transition-all border-[3px] ${
                        canClick
                          ? "border-emerald-400 hover:scale-105 cursor-pointer ring-4 ring-emerald-500/30"
                          : isLastMoved
                          ? "border-amber-300 ring-2 ring-amber-400/40"
                          : "border-[#2d1206] cursor-default"
                      }`}
                    >
                      <NickernutSeedCluster count={count} pitSeedOffset={pitIdx * 5 + 1} />

                      {/* Seed Count Badge */}
                      <span
                        className={`absolute -bottom-1.5 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-black font-mono shadow-md border ${
                          canClick
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
                  {creatorName}&apos;s Plank (South Row {mySide === "creator" ? "• YOU" : ""})
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
            className="flex lg:flex-col items-center justify-between lg:justify-center p-3.5 rounded-[36px] border-2 border-[#35373d] shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[115px] lg:min-h-[270px]"
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-center mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-400 truncate max-w-[115px]">
                {creatorName}
              </p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-300 font-mono">
                {game.scores.creator}
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center"
              style={terracottaBowlStyle}
            >
              <NickernutSeedCluster count={game.scores.creator} pitSeedOffset={40} />
            </div>
          </div>
        </div>

        {/* Hover Move Preview Bar */}
        {hoveredPit !== null && isMyTurn && game.pits[hoveredPit] > 0 && (
          <div className="mt-3 text-center text-xs text-amber-200/90 font-semibold">
            Sowing <strong>{game.pits[hoveredPit]} nickernut seeds</strong> from Bowl #{hoveredPit + 1} counter-clockwise...
          </div>
        )}
      </div>
    </div>
  );
}
