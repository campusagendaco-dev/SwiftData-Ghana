import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Crown,
  HelpCircle,
  Brain,
  Volume2,
  VolumeX,
  Smartphone,
  Trophy,
  RotateCcw,
  Gamepad2,
  Eye,
} from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import { InGameVoiceChat } from "@/components/games/InGameVoiceChat";
import {
  playWoodSeedClack,
  playLevelUpFanfare,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  HUMAN_CHALLENGER_PERSONAS,
  sampleGaussianError,
} from "@/lib/game-sensory-engine";

export interface DamePiece {
  side: "creator" | "opponent";
  king: boolean;
}

export interface DameMove {
  fromR: number;
  fromC: number;
  toR: number;
  toC: number;
  captured?: { r: number; c: number } | null;
}

export interface DameState {
  board: (DamePiece | null)[][]; // 8x8 grid
  turn: "creator" | "opponent";
  capturedCount: { creator: number; opponent: number };
  lastMove?: string;
  winner?: "creator" | "opponent" | "draw" | null;
  moveCount: number;
}

function createInitialDameBoard(): (DamePiece | null)[][] {
  const grid: (DamePiece | null)[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null)
  );
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) grid[r][c] = { side: "opponent", king: false };
        else if (r > 4) grid[r][c] = { side: "creator", king: false };
      }
    }
  }
  return grid;
}

export const INITIAL_DAME_STATE: DameState = {
  board: createInitialDameBoard(),
  turn: "creator",
  capturedCount: { creator: 0, opponent: 0 },
  lastMove: "Tap one of your Gold Dame pieces to move diagonally!",
  winner: null,
  moveCount: 0,
};

export function getLegalDameMoves(
  board: (DamePiece | null)[][],
  side: "creator" | "opponent"
): DameMove[] {
  const jumps: DameMove[] = [];
  const steps: DameMove[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.side !== side) continue;

      const dirs = piece.king
        ? [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ]
        : side === "creator"
        ? [
            [-1, -1],
            [-1, 1],
          ]
        : [
            [1, -1],
            [1, 1],
          ];

      // Check jumps in all 4 diagonal directions (Ghanaian Dame allows backward capture jumps too!)
      const jumpDirs = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];
      for (const [dr, dc] of jumpDirs) {
        const midR = r + dr;
        const midC = c + dc;
        const landR = r + dr * 2;
        const landC = c + dc * 2;
        if (
          landR >= 0 &&
          landR < 8 &&
          landC >= 0 &&
          landC < 8 &&
          board[midR]?.[midC] &&
          board[midR][midC]?.side !== side &&
          !board[landR][landC]
        ) {
          jumps.push({
            fromR: r,
            fromC: c,
            toR: landR,
            toC: landC,
            captured: { r: midR, c: midC },
          });
        }
      }

      // Normal step moves
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr][nc]) {
          steps.push({ fromR: r, fromC: c, toR: nr, toC: nc, captured: null });
        }
      }
    }
  }

  // Ghanaian Dame mandatory capture rule: if a jump is available, player must jump!
  return jumps.length > 0 ? jumps : steps;
}

export function applyDameMove(
  state: DameState,
  move: DameMove,
  side: "creator" | "opponent"
): DameState {
  const nextBoard = state.board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
  const piece = nextBoard[move.fromR][move.fromC];
  nextBoard[move.fromR][move.fromC] = null;

  const crowned =
    piece?.king ||
    (side === "creator" && move.toR === 0) ||
    (side === "opponent" && move.toR === 7);

  nextBoard[move.toR][move.toC] = {
    side,
    king: Boolean(crowned),
  };

  const nextCaptured = { ...state.capturedCount };
  if (move.captured) {
    nextBoard[move.captured.r][move.captured.c] = null;
    if (side === "creator") nextCaptured.creator += 1;
    else nextCaptured.opponent += 1;
  }

  const oppSide: "creator" | "opponent" = side === "creator" ? "opponent" : "creator";
  const oppMoves = getLegalDameMoves(nextBoard, oppSide);

  let winner: "creator" | "opponent" | "draw" | null = null;
  if (nextCaptured.creator >= 12 || nextCaptured.opponent >= 12 || oppMoves.length === 0) {
    winner = side;
  }

  return {
    board: nextBoard,
    turn: oppSide,
    capturedCount: nextCaptured,
    lastMove: move.captured
      ? `🔥 ${side === "creator" ? "Gold" : "Crimson"} jumped & captured an opponent piece!`
      : `${side === "creator" ? "Gold" : "Crimson"} moved to (${move.toR + 1}, ${move.toC + 1}).`,
    winner,
    moveCount: (state.moveCount || 0) + 1,
  };
}

/** Grandmaster Dame 5-Ply Alpha-Beta Board Evaluator */
function evaluateDameBoard(state: DameState): number {
  if (state.winner === "opponent") return 100000;
  if (state.winner === "creator") return -100000;

  let score = (state.capturedCount.opponent - state.capturedCount.creator) * 145;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const val = p.king ? 265 : 100;
      const isEdge = c === 0 || c === 7;
      const isCenter = r >= 2 && r <= 5 && c >= 2 && c <= 5;

      if (p.side === "opponent") {
        score += val;
        if (!p.king) score += r * 7; // Advance toward promotion
        if (r === 0) score += 45; // Guard back row so human cannot crown Kings!
        if (isEdge) score += 16; // Safe from being jumped on board edges
        if (isCenter) score += 18;
      } else {
        score -= val;
        if (!p.king) score -= (7 - r) * 7;
        if (r === 7) score -= 35;
        if (isEdge) score -= 12;
        if (isCenter) score -= 15;
      }
    }
  }

  return score;
}

function minimaxDame(
  state: DameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean
): number {
  if (depth === 0 || state.winner) {
    return evaluateDameBoard(state);
  }

  const side = maximizing ? "opponent" : "creator";
  const moves = getLegalDameMoves(state.board, side);
  if (moves.length === 0) {
    return maximizing ? -100000 : 100000;
  }

  if (maximizing) {
    let maxEval = -Infinity;
    for (const m of moves) {
      const next = applyDameMove(state, m, "opponent");
      const val = minimaxDame(next, depth - 1, alpha, beta, false);
      if (val > maxEval) maxEval = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of moves) {
      const next = applyDameMove(state, m, "creator");
      const val = minimaxDame(next, depth - 1, alpha, beta, true);
      if (val < minEval) minEval = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function pickBestDameAiMove(state: DameState, legal: DameMove[], playerLevel = 1): DameMove {
  let bestMove = legal[0];
  let bestScore = -Infinity;
  const searchDepth = playerLevel >= 5 ? 3 : 2;
  const noiseSigma = Math.max(16, 38 - playerLevel * 3);

  for (const m of legal) {
    const sim = applyDameMove(state, m, "opponent");
    const rawScore = minimaxDame(sim, searchDepth, -Infinity, Infinity, false);
    const humanScore = rawScore + sampleGaussianError(noiseSigma);
    if (humanScore > bestScore) {
      bestScore = humanScore;
      bestMove = m;
    }
  }

  return bestMove;
}

interface DameCheckersBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  roomCode?: string;
  challengeId?: string;
  initialState?: DameState;
  onStateChange?: (nextState: DameState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: DameState) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
  prizePoolGhs?: number;
  onRematch?: () => void;
  onPlayAnotherGame?: () => void;
}

export function DameCheckersBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  roomCode,
  challengeId,
  initialState,
  onStateChange,
  onMatchComplete,
  onPointsEarned,
  playerLevel = 1,
  prizePoolGhs = 0,
  onRematch,
  onPlayAnotherGame,
}: DameCheckersBoardProps) {
  const persona = HUMAN_CHALLENGER_PERSONAS.dame;
  const effectiveOpponentName =
    mode === "p2p"
      ? opponentName
      : opponentName && !opponentName.toLowerCase().includes("ai")
      ? opponentName
      : persona.name;

  const [game, setGame] = useState<DameState>(() =>
    initialState && Array.isArray(initialState.board) ? initialState : INITIAL_DAME_STATE
  );
  const [selectedSq, setSelectedSq] = useState<{ r: number; c: number } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(
    () => getGameSensoryPreferences().soundEnabled
  );
  const [vibrationEnabled, setVibrationEnabled] = useState(
    () => getGameSensoryPreferences().vibrationEnabled
  );
  const [dismissedWinnerPopup, setDismissedWinnerPopup] = useState(false);
  const notifiedWinnerRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      initialState &&
      Array.isArray(initialState.board) &&
      ((initialState.moveCount || 0) > (game.moveCount || 0) ||
        Boolean(initialState.winner && !game.winner) ||
        ((initialState.moveCount || 0) === (game.moveCount || 0) &&
          initialState.turn &&
          initialState.turn !== game.turn))
    ) {
      setGame(initialState);
      setSelectedSq(null);
    }
  }, [initialState, game.moveCount, game.turn, game.winner]);

  useEffect(() => {
    if (!game.winner) return;
    const winKey = `${game.moveCount || 0}-${game.winner}`;
    if (notifiedWinnerRef.current === winKey) return;
    notifiedWinnerRef.current = winKey;
    setDismissedWinnerPopup(false);
    onMatchComplete?.(game.winner, game);
  }, [game, onMatchComplete]);

  const handleInBoardRematch = useCallback(() => {
    setDismissedWinnerPopup(false);
    notifiedWinnerRef.current = null;
    if (onRematch) {
      onRematch();
      if (mode !== "p2p") {
        setGame(INITIAL_DAME_STATE);
        onStateChange?.(INITIAL_DAME_STATE);
      }
      return;
    }
    setGame(INITIAL_DAME_STATE);
    onStateChange?.(INITIAL_DAME_STATE);
  }, [onRematch, mode, onStateChange]);

  const isMyTurn =
    !game.winner &&
    (game.turn === mySide || (mode === "p2p" && (game.moveCount || 0) === 0));
  const allLegalMoves = isMyTurn ? getLegalDameMoves(game.board, mySide) : [];
  const selectedMoves = selectedSq
    ? allLegalMoves.filter((m) => m.fromR === selectedSq.r && m.fromC === selectedSq.c)
    : [];

  const handleSquareClick = useCallback(
    (r: number, c: number) => {
      if (!isMyTurn || game.winner) return;

      // Check if clicking a valid destination for currently selected piece
      const chosenMove = selectedMoves.find((m) => m.toR === r && m.toC === c);
      if (chosenMove) {
        const nextState = applyDameMove(game, chosenMove, mySide);
        if (chosenMove.captured) {
          playSuccessSound();
          triggerHapticSensor("pocket_drop");
          onPointsEarned?.(35, "Captured Opponent Dame Piece (+35 Pts)");
        } else {
          playWoodSeedClack(r + c);
          triggerHapticSensor("seed_drop");
        }

        setSelectedSq(null);
        setGame(nextState);
        onStateChange?.(nextState);
        if (nextState.winner) {
          if (nextState.winner === mySide) {
            playLevelUpFanfare();
            triggerHapticSensor("victory");
            onPointsEarned?.(300, "Ghanaian Dame Match Victory (+300 Pts)");
          }
          onMatchComplete?.(nextState.winner, nextState);
        }
        return;
      }

      // Otherwise check if clicking own piece that has legal moves
      const hasMoveFromHere = allLegalMoves.some((m) => m.fromR === r && m.fromC === c);
      if (hasMoveFromHere) {
        setSelectedSq({ r, c });
        playSound("click");
        triggerHapticSensor("aim_tick");
      } else {
        setSelectedSq(null);
      }
    },
    [isMyTurn, game, selectedMoves, allLegalMoves, mySide, onStateChange, onMatchComplete, onPointsEarned]
  );

  // Human-Sense Challenger Opponent Turn (Medium Difficulty)
  useEffect(() => {
    if ((mode === "ai" || mode === "free_data") && !game.winner && game.turn === "opponent") {
      const humanDelay = 720 + Math.floor(Math.random() * 480);
      const timer = setTimeout(() => {
        const legal = getLegalDameMoves(game.board, "opponent");
        if (legal.length === 0) {
          const wonState: DameState = { ...game, winner: "creator" };
          setGame(wonState);
          onMatchComplete?.("creator", wonState);
          return;
        }

        const bestMove = pickBestDameAiMove(game, legal, playerLevel);
        const nextState = applyDameMove(game, bestMove, "opponent");
        playWoodSeedClack(bestMove.toR + bestMove.toC);
        setGame(nextState);
        onStateChange?.(nextState);
        if (nextState.winner) onMatchComplete?.(nextState.winner, nextState);
      }, humanDelay);

      return () => clearTimeout(timer);
    }
  }, [mode, game, playerLevel, onStateChange, onMatchComplete]);

  const screenFit = useDeviceScreenFit();
  const dameFit = screenFit.computeBoardStageMetrics("dame", { reservedTopPx: 38 });

  return (
    <div className="space-y-2 sm:space-y-3 max-w-xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:p-2.5 rounded-2xl bg-amber-950/40 border border-amber-500/30">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] sm:text-xs px-2 py-0.5">
            ♟️ GHANA DAME
          </Badge>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${dameFit.squareBoardSizePx}×${dameFit.squareBoardSizePx}px board)`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[9px] font-mono font-bold text-sky-300"
          >
            📱 {dameFit.fitSummaryLabel}
          </span>
          {mode !== "p2p" && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[9px] font-bold gap-1"
            >
              <Brain className="w-2.5 h-2.5" />
              {effectiveOpponentName} • {persona.humanSensePercent}% AI
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <InGameVoiceChat
            roomCode={roomCode || "DAME"}
            challengeId={challengeId}
            mySide={mySide}
            myName={mySide === "creator" ? creatorName : effectiveOpponentName}
            opponentName={mySide === "creator" ? effectiveOpponentName : creatorName}
            mode={mode}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleInBoardRematch}
            className="h-7 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] gap-1 cursor-pointer shadow"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Rematch</span>
          </Button>
          {onPlayAnotherGame && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onPlayAnotherGame}
              className="h-7 px-2.5 rounded-xl border-emerald-400/50 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 font-black text-[10px] gap-1 cursor-pointer"
            >
              <Gamepad2 className="w-3 h-3" />
              <span>Play Another</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRules((v) => !v)}
            className="h-7 px-2 text-[10px] text-amber-300 gap-1"
          >
            <HelpCircle className="w-3 h-3" />
            {showRules ? "Hide" : "Rules"}
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
            className={`h-7 px-1.5 text-xs ${vibrationEnabled ? "text-emerald-300" : "text-slate-500"}`}
            title="Toggle Haptic Vibration Sensor"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              setGameSensoryPreferences({ soundEnabled: next });
            }}
            className="h-7 w-7 p-0 text-amber-300"
            title={soundEnabled ? "Mute Sound" : "Enable Sound"}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {showRules && (
        <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/30 text-xs text-slate-200 space-y-1">
          <p className="font-black text-amber-400">🇬🇭 Ghanaian Dame Rules:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Tap any of your glowing pieces, then tap a highlighted green target square to move diagonally.</li>
            <li><strong>Mandatory Capture</strong>: Whenever a jump over an opponent piece is available, it is automatically highlighted for capture (+35 Pts)!</li>
            <li>Reach the opposite back row to crown your piece a <strong>King (👑)</strong> that moves &amp; jumps in all 4 diagonal directions!</li>
          </ul>
        </div>
      )}

      {/* Compact Score & Turn Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-white/10 text-[11px] sm:text-xs">
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black text-[10px]">
            🟡 {creatorName}: {game.capturedCount.creator}/12
          </Badge>
          <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black text-[10px]">
            🔴 {effectiveOpponentName}: {game.capturedCount.opponent}/12
          </Badge>
        </div>
        <span className="font-black text-white">
          {game.winner
            ? game.winner === mySide
              ? "🏆 YOU WON!"
              : `🏅 ${game.winner === "creator" ? creatorName : effectiveOpponentName} Won!`
            : isMyTurn
            ? "🟢 YOUR TURN — Tap piece"
            : `⏳ ${game.turn === "creator" ? creatorName : effectiveOpponentName}...`}
        </span>
      </div>

      {/* 8x8 Ghanaian Dame Wooden Board (Mathematically Fitted to Device Screen) */}
      <div
        style={{
          width: `${dameFit.squareBoardSizePx}px`,
          height: `${dameFit.squareBoardSizePx}px`,
        }}
        className="mx-auto p-2 sm:p-2.5 rounded-2xl bg-[#3a1d0d] border-4 border-[#6b3719] shadow-2xl flex items-center justify-center"
      >
        <div className="w-full h-full grid grid-cols-8 border-2 border-[#241006] rounded-lg overflow-hidden">
          {game.board.map((row, r) =>
            row.map((cell, c) => {
              const isDark = (r + c) % 2 === 1;
              const isSelected = selectedSq?.r === r && selectedSq?.c === c;
              const isTarget = selectedMoves.some((m) => m.toR === r && m.toC === c);
              const isMovablePiece =
                isMyTurn && allLegalMoves.some((m) => m.fromR === r && m.fromC === c);

              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onClick={() => handleSquareClick(r, c)}
                  className={`aspect-square flex items-center justify-center relative transition-all ${
                    isDark ? "bg-[#2b1408]" : "bg-[#d7b38c]"
                  } ${isTarget ? "ring-inset ring-4 ring-emerald-400 bg-emerald-900/60" : ""}`}
                >
                  {isTarget && !cell && (
                    <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 animate-ping" />
                  )}
                  {cell && (
                    <div
                      className={`w-[78%] h-[78%] rounded-full flex items-center justify-center border-2 shadow-md transition-transform ${
                        cell.side === "creator"
                          ? "bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 border-amber-100 text-slate-950"
                          : "bg-gradient-to-br from-rose-400 via-rose-600 to-rose-900 border-rose-200 text-white"
                      } ${isSelected ? "scale-110 ring-2 ring-white" : ""} ${
                        isMovablePiece ? "ring-2 ring-emerald-400 animate-pulse" : ""
                      }`}
                    >
                      {cell.king && <Crown className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── GHANAIAN DAME WINNER SPOTLIGHT & REMATCH / PLAY ANOTHER POPUP ── */}
      {game.winner && !dismissedWinnerPopup && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-3xl bg-gradient-to-b from-slate-900 via-[#111827] to-slate-950 border-2 border-amber-400/70 shadow-[0_0_60px_rgba(245,158,11,0.35)] p-5 sm:p-6 text-center space-y-4">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[11px] font-black uppercase tracking-wider">
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>Ghanaian Dame • Winner Spotlight</span>
              </div>
              <InGameVoiceChat
                roomCode={roomCode || "DAME"}
                challengeId={challengeId}
                mySide={mySide}
                myName={mySide === "creator" ? creatorName : effectiveOpponentName}
                opponentName={mySide === "creator" ? effectiveOpponentName : creatorName}
                mode={mode}
              />
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 p-1 shadow-[0_0_35px_rgba(251,191,36,0.6)]">
                <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                  <Trophy className="w-10 h-10 text-amber-400 animate-bounce" />
                </div>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {game.winner === "draw"
                  ? "🤝 Match Draw!"
                  : `🏆 ${
                      game.winner === "creator" ? creatorName : effectiveOpponentName
                    } Wins!`}
              </h2>
              <p className="text-xs text-slate-300 font-semibold">
                Captured Pieces: {creatorName} ({game.capturedCount.creator}/12) vs{" "}
                {effectiveOpponentName} ({game.capturedCount.opponent}/12)
              </p>
              {prizePoolGhs > 0 && game.winner !== "draw" && (
                <div className="px-4 py-1.5 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-black">
                  💰 Winner Payout: GH₵ {prizePoolGhs.toFixed(2)}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <Button
                type="button"
                onClick={handleInBoardRematch}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-400 via-amber-400 to-orange-500 text-slate-950 font-black text-sm shadow-lg gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>
                  {game.winner === mySide
                    ? "🔄 Play Rematch"
                    : `🔄 Request Rematch vs ${
                        game.winner === "creator" ? creatorName : effectiveOpponentName
                      }`}
                </span>
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {onPlayAnotherGame ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onPlayAnotherGame}
                    className="h-10 rounded-xl border-sky-400/50 bg-sky-500/15 text-sky-200 font-black text-xs gap-1.5 cursor-pointer"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    <span>Play Another Game</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleInBoardRematch}
                    className="h-10 rounded-xl border-sky-400/50 bg-sky-500/15 text-sky-200 font-black text-xs gap-1.5 cursor-pointer"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    <span>New Match</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDismissedWinnerPopup(true)}
                  className="h-10 rounded-xl border border-white/15 bg-white/5 text-slate-300 font-bold text-xs gap-1.5 cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>View Board</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
