import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Crown, HelpCircle } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";

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
  if (nextCaptured.creator >= 12 || oppMoves.length === 0) {
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

interface DameCheckersBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: DameState;
  onStateChange?: (nextState: DameState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: DameState) => void;
}

export function DameCheckersBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
}: DameCheckersBoardProps) {
  const [game, setGame] = useState<DameState>(() =>
    initialState && Array.isArray(initialState.board) ? initialState : INITIAL_DAME_STATE
  );
  const [selectedSq, setSelectedSq] = useState<{ r: number; c: number } | null>(null);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (
      initialState &&
      Array.isArray(initialState.board) &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame(initialState);
      setSelectedSq(null);
    }
  }, [initialState, game.moveCount]);

  const isMyTurn = !game.winner && game.turn === mySide;
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
        if (chosenMove.captured) playSuccessSound();
        else playSound("click");

        setSelectedSq(null);
        setGame(nextState);
        onStateChange?.(nextState);
        if (nextState.winner) onMatchComplete?.(nextState.winner, nextState);
        return;
      }

      // Otherwise check if clicking own piece that has legal moves
      const hasMoveFromHere = allLegalMoves.some((m) => m.fromR === r && m.fromC === c);
      if (hasMoveFromHere) {
        setSelectedSq({ r, c });
        playSound("click");
      } else {
        setSelectedSq(null);
      }
    },
    [isMyTurn, game, selectedMoves, allLegalMoves, mySide, onStateChange, onMatchComplete]
  );

  // AI Opponent Turn
  useEffect(() => {
    if ((mode === "ai" || mode === "free_data") && !game.winner && game.turn === "opponent") {
      const timer = setTimeout(() => {
        const legal = getLegalDameMoves(game.board, "opponent");
        if (legal.length === 0) {
          const wonState: DameState = { ...game, winner: "creator" };
          setGame(wonState);
          onMatchComplete?.("creator", wonState);
          return;
        }

        // Prioritize captures, king promotions, and center control
        let bestMove = legal[0];
        let bestScore = -Infinity;
        for (const m of legal) {
          let score = 0;
          if (m.captured) score += 50;
          if (m.toR === 7) score += 35;
          if (m.toC >= 2 && m.toC <= 5) score += 8;
          // Look ahead 1 reply to avoid blundering into a capture
          const sim = applyDameMove(game, m, "opponent");
          const humanReplies = getLegalDameMoves(sim.board, "creator");
          if (humanReplies.some((hr) => hr.captured)) score -= 25;
          if (score > bestScore) {
            bestScore = score;
            bestMove = m;
          }
        }

        const nextState = applyDameMove(game, bestMove, "opponent");
        playSound("click");
        setGame(nextState);
        onStateChange?.(nextState);
        if (nextState.winner) onMatchComplete?.(nextState.winner, nextState);
      }, 850);

      return () => clearTimeout(timer);
    }
  }, [mode, game, onStateChange, onMatchComplete]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/30">
        <div className="flex items-center gap-2.5">
          <Badge className="bg-amber-500 text-slate-950 font-black text-xs px-3 py-1">
            ♟️ GHANAIAN DAME (DRAUGHTS)
          </Badge>
          <span className="text-xs text-amber-200 font-semibold">
            Mandatory jumps & Crowned Kings!
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowRules((v) => !v)}
          className="h-8 text-xs text-amber-300 gap-1"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          {showRules ? "Hide Rules" : "Dame Rules"}
        </Button>
      </div>

      {showRules && (
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-amber-500/30 text-xs text-slate-200 space-y-1">
          <p className="font-black text-amber-400">🇬🇭 Ghanaian Dame Rules:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Tap any of your glowing pieces, then tap a highlighted green target square to move diagonally.</li>
            <li><strong>Mandatory Capture</strong>: Whenever a jump over an opponent piece is available, it is automatically highlighted for capture!</li>
            <li>Reach the opposite back row to crown your piece a <strong>King (👑)</strong> that moves & jumps in all 4 diagonal directions!</li>
          </ul>
        </div>
      )}

      {/* Score & Turn Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-900/90 border border-white/10 text-xs">
        <div className="flex items-center gap-3">
          <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black">
            🟡 {creatorName}: {game.capturedCount.creator}/12 Captured
          </Badge>
          <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40 font-black">
            🔴 {opponentName}: {game.capturedCount.opponent}/12 Captured
          </Badge>
        </div>
        <span className="font-black text-white">
          {game.winner
            ? game.winner === mySide
              ? "🏆 YOU WON THE DAME CHALLENGE!"
              : `🏅 ${game.winner === "creator" ? creatorName : opponentName} Won!`
            : isMyTurn
            ? "🟢 YOUR TURN — Select a glowing piece"
            : `⏳ ${game.turn === "creator" ? creatorName : opponentName}'s turn...`}
        </span>
      </div>

      {/* 8x8 Ghanaian Dame Wooden Board */}
      <div className="max-w-[440px] mx-auto p-3 rounded-2xl bg-[#3a1d0d] border-4 border-[#6b3719] shadow-2xl">
        <div className="grid grid-cols-8 border-2 border-[#241006] rounded-lg overflow-hidden">
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
    </div>
  );
}

