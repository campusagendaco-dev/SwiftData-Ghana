import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Sparkles, HelpCircle } from "lucide-react";
import { playSound, playSuccessSound } from "@/lib/sound";

export interface AmpeState {
  scores: { creator: number; opponent: number };
  round: number;
  creatorChoice?: "left" | "right" | null;
  opponentChoice?: "left" | "right" | null;
  lastResult?: string;
  winner?: "creator" | "opponent" | null;
  moveCount: number;
}

export const INITIAL_AMPE_STATE: AmpeState = {
  scores: { creator: 0, opponent: 0 },
  round: 1,
  creatorChoice: null,
  opponentChoice: null,
  lastResult: "Jump, clap & thrust Left or Right foot! Ohyiwa (Same Foot) scores for Creator; Opare (Opposite Foot) scores for Opponent!",
  winner: null,
  moveCount: 0,
};

interface AmpeQuickDuelProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: AmpeState;
  onStateChange?: (nextState: AmpeState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: AmpeState) => void;
}

export function AmpeQuickDuel({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
}: AmpeQuickDuelProps) {
  const [game, setGame] = useState<AmpeState>(() =>
    initialState && initialState.scores ? initialState : INITIAL_AMPE_STATE
  );
  const [jumping, setJumping] = useState(false);

  useEffect(() => {
    if (
      initialState &&
      initialState.scores &&
      (initialState.moveCount || 0) > (game.moveCount || 0)
    ) {
      setGame(initialState);
    }
  }, [initialState, game.moveCount]);

  const handleThrustFoot = (foot: "left" | "right") => {
    if (game.winner || jumping) return;
    setJumping(true);
    playSound("click");

    setTimeout(() => {
      setJumping(false);

      // In AI or Free Data mode, AI simultaneously chooses a foot
      if (mode === "ai" || mode === "free_data") {
        const aiFoot: "left" | "right" = Math.random() < 0.5 ? "left" : "right";
        const sameFoot = foot === aiFoot; // Ohyiwa (Creator) wins on same foot; Opare (Opponent) wins on opposite foot!
        const nextScores = {
          creator: game.scores.creator + (sameFoot ? 1 : 0),
          opponent: game.scores.opponent + (!sameFoot ? 1 : 0),
        };

        let winner: "creator" | "opponent" | null = null;
        if (nextScores.creator >= 5) winner = "creator";
        else if (nextScores.opponent >= 5) winner = "opponent";

        if (sameFoot) playSuccessSound();

        const nextState: AmpeState = {
          scores: nextScores,
          round: game.round + 1,
          creatorChoice: foot,
          opponentChoice: aiFoot,
          lastResult: sameFoot
            ? `👏 OHYIWA! Both thrust ${foot.toUpperCase()} foot — +1 Point for ${creatorName}!`
            : `⚡ OPARE! You thrust ${foot.toUpperCase()}, ${opponentName} thrust ${aiFoot.toUpperCase()} — +1 Point for ${opponentName}!`,
          winner,
          moveCount: (game.moveCount || 0) + 1,
        };

        setGame(nextState);
        onStateChange?.(nextState);
        if (winner) onMatchComplete?.(winner, nextState);
        return;
      }

      // Live P2P mode: record my choice; when both sides have chosen, resolve the round!
      const nextCreatorChoice = mySide === "creator" ? foot : game.creatorChoice;
      const nextOpponentChoice = mySide === "opponent" ? foot : game.opponentChoice;

      if (nextCreatorChoice && nextOpponentChoice) {
        const sameFoot = nextCreatorChoice === nextOpponentChoice;
        const nextScores = {
          creator: game.scores.creator + (sameFoot ? 1 : 0),
          opponent: game.scores.opponent + (!sameFoot ? 1 : 0),
        };
        let winner: "creator" | "opponent" | null = null;
        if (nextScores.creator >= 5) winner = "creator";
        else if (nextScores.opponent >= 5) winner = "opponent";

        const resolvedState: AmpeState = {
          scores: nextScores,
          round: game.round + 1,
          creatorChoice: null,
          opponentChoice: null,
          lastResult: sameFoot
            ? `👏 OHYIWA! Both thrust ${nextCreatorChoice.toUpperCase()} foot — +1 Point for ${creatorName}!`
            : `⚡ OPARE! Opposite feet (${nextCreatorChoice.toUpperCase()} vs ${nextOpponentChoice.toUpperCase()}) — +1 Point for ${opponentName}!`,
          winner,
          moveCount: (game.moveCount || 0) + 1,
        };
        setGame(resolvedState);
        onStateChange?.(resolvedState);
        if (winner) onMatchComplete?.(winner, resolvedState);
      } else {
        const waitingState: AmpeState = {
          ...game,
          creatorChoice: nextCreatorChoice || null,
          opponentChoice: nextOpponentChoice || null,
          lastResult: `Waiting for ${mySide === "creator" ? opponentName : creatorName} to thrust their foot...`,
          moveCount: (game.moveCount || 0) + 1,
        };
        setGame(waitingState);
        onStateChange?.(waitingState);
      }
    }, 300);
  };

  const waitingForOtherPlayer =
    mode === "p2p" &&
    ((mySide === "creator" && Boolean(game.creatorChoice) && !game.opponentChoice) ||
      (mySide === "opponent" && Boolean(game.opponentChoice) && !game.creatorChoice));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-purple-950/40 border border-purple-500/30">
        <div className="flex items-center gap-2.5">
          <Badge className="bg-purple-500 text-white font-black text-xs px-3 py-1">
            ⚡ GHANA AMPE 60s DUEL
          </Badge>
          <span className="text-xs text-purple-200 font-semibold">
            Ohyiwa (Same Foot) vs Opare (Opposite Foot) • First to <strong>5 Points</strong>!
          </span>
        </div>
        <Badge variant="outline" className="border-amber-500/40 text-amber-300 font-mono">
          Round #{game.round}
        </Badge>
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-center">
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
            Ohyiwa (Same Foot Wins)
          </p>
          <p className="text-sm font-bold text-white truncate mt-0.5">{creatorName}</p>
          <p className="text-4xl font-black text-emerald-400 font-mono mt-1">
            {game.scores.creator} <span className="text-xs text-muted-foreground">/ 5</span>
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/30 text-center">
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-400">
            Opare (Opposite Foot Wins)
          </p>
          <p className="text-sm font-bold text-white truncate mt-0.5">{opponentName}</p>
          <p className="text-4xl font-black text-amber-400 font-mono mt-1">
            {game.scores.opponent} <span className="text-xs text-muted-foreground">/ 5</span>
          </p>
        </div>
      </div>

      {/* Arena Stage */}
      <div className="p-6 rounded-3xl bg-gradient-to-b from-slate-900 via-purple-950/30 to-slate-950 border border-purple-500/30 text-center space-y-5">
        <p className="text-xs sm:text-sm font-black text-amber-300">{game.lastResult}</p>

        {!game.winner && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              disabled={jumping || waitingForOtherPlayer}
              onClick={() => handleThrustFoot("left")}
              className="w-full sm:w-52 h-14 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-base gap-2 shadow-xl"
            >
              👟 Thrust LEFT Foot
            </Button>
            <Button
              size="lg"
              disabled={jumping || waitingForOtherPlayer}
              onClick={() => handleThrustFoot("right")}
              className="w-full sm:w-52 h-14 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-base gap-2 shadow-xl"
            >
              👟 Thrust RIGHT Foot
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

