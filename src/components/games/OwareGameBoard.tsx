import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Volume2,
  VolumeX,
  HelpCircle,
  Sparkles,
  Flame,
  Smartphone,
  Brain,
  Trophy,
  Crown,
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
} from "@/lib/game-sensory-engine";
// Rules + AI are shared with the challenge-arena edge function so the server
// can replay and verify every move of a server-checked match.
import {
  INITIAL_OWARE_STATE,
  OWARE_DIFFICULTY_PROFILES,
  chooseOwareAiMove,
  getLegalOwareMoves,
  settleIfNoLegalMoves,
  simulateAbapaMoveWithSteps,
  simulateNamNamMoveWithSteps,
  sumSeedsOnSide,
  type OwareAnimationStep,
  type OwareDifficulty,
  type OwareRuleVariant,
  type OwareState,
} from "../../../supabase/functions/_shared/oware_engine";

export {
  INITIAL_OWARE_STATE,
  getLegalOwareMoves,
  simulateAbapaMoveWithSteps,
  simulateNamNamMoveWithSteps,
  simulateOwareMove,
  sumSeedsOnSide,
} from "../../../supabase/functions/_shared/oware_engine";
export type { OwareAnimationStep, OwareRuleVariant, OwareState } from "../../../supabase/functions/_shared/oware_engine";

export type OwareSowingSpeed = "slow" | "normal" | "fast";

/** Result of a server-checked move: the server's authoritative board and the AI replies it played. */
export interface OwareServerMoveResult {
  ok: boolean;
  board?: OwareState;
  aiMoves?: number[];
  error?: string;
}
const HAND_MOVE_DURATION_MS = 480;
const HAND_DROP_PAUSE_MS = 180;
const HAND_MAXIMUM_SEEDS_DRAWN = 12;
const MAXIMUM_SEEDS_DRAWN_PER_PIT = 28;

const OWARE_SPEED_PROFILES: Record<
  OwareSowingSpeed,
  {
    label: string;
    moveMs: number;
    dropPauseMs: number;
    scoopBonusPauseMs: number;
    aiDelayMs: number;
  }
> = {
  slow: {
    label: "🐢 Slow",
    moveMs: 950,
    dropPauseMs: 580,
    scoopBonusPauseMs: 1150,
    aiDelayMs: 3400,
  },
  normal: {
    label: "🚶 Normal",
    moveMs: 720,
    dropPauseMs: 420,
    scoopBonusPauseMs: 850,
    aiDelayMs: 2600,
  },
  fast: {
    label: "⚡ Fast",
    moveMs: 460,
    dropPauseMs: 240,
    scoopBonusPauseMs: 480,
    aiDelayMs: 1600,
  },
};

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
  moveDurationMs = HAND_MOVE_DURATION_MS,
}: {
  visible: boolean;
  x: number;
  y: number;
  widthPx: number;
  isTopPlayer: boolean;
  isInstant: boolean;
  isPulsing: boolean;
  seedCount: number;
  moveDurationMs?: number;
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
        transitionDuration: isInstant ? "0ms" : `${moveDurationMs}ms`,
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
  roomCode?: string;
  challengeId?: string;
  initialState?: OwareState;
  onStateChange?: (nextState: OwareState) => void;
  onMatchComplete?: (winnerSide: "creator" | "opponent" | "draw", finalState: OwareState) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
  prizePoolGhs?: number;
  onRematch?: () => void;
  onPlayAnotherGame?: () => void;
  /** Server replays every move and plays the AI (staked / reward matches vs AI). */
  serverChecked?: boolean;
  onServerMove?: (pit: number, variant: OwareRuleVariant) => Promise<OwareServerMoveResult>;
}

export function OwareGameBoard({
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
  serverChecked = false,
  onServerMove,
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
  const [aiDifficulty, setAiDifficulty] = useState<OwareDifficulty>(() => {
    try {
      const saved = localStorage.getItem("swiftdata_oware_difficulty_v1") as OwareDifficulty | null;
      if (saved && saved in OWARE_DIFFICULTY_PROFILES) return saved;
    } catch {
      // ignore
    }
    return "medium";
  });
  // AI replies + authoritative board returned by the server for the last move.
  const [serverReply, setServerReply] = useState<{ aiMoves: number[]; board: OwareState | null } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sowingSpeed, setSowingSpeed] = useState<OwareSowingSpeed>(() => {
    try {
      const saved = localStorage.getItem("swiftdata_oware_speed_v2") as OwareSowingSpeed | null;
      if (saved === "slow" || saved === "normal" || saved === "fast") return saved;
    } catch {
      // ignore
    }
    return "slow";
  });
  const [muted, setMuted] = useState(() => !getGameSensoryPreferences().soundEnabled);
  const [vibrationEnabled, setVibrationEnabled] = useState(
    () => getGameSensoryPreferences().vibrationEnabled
  );
  const [dismissedWinnerPopup, setDismissedWinnerPopup] = useState(false);
  const notifiedWinnerRef = useRef<string | null>(null);

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
  const animSubTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
      if (animSubTimerRef.current) window.clearTimeout(animSubTimerRef.current);
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

  // Whenever game.winner becomes set (from local move, AI move, or P2P opponent move),
  // open the Winner Spotlight Popup and notify parent onMatchComplete once!
  useEffect(() => {
    if (!game.winner || isAnimating) return;
    const winKey = `${game.moveCount || 0}-${game.winner}`;
    if (notifiedWinnerRef.current === winKey) return;
    notifiedWinnerRef.current = winKey;
    setDismissedWinnerPopup(false);
    onMatchComplete?.(game.winner, game);
  }, [game, isAnimating, onMatchComplete]);

  // Step-by-step animated sowing player with Two-Phase Hand Glide -> Seed Drop/Scoop & Pause
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
        return;
      }

      if (animTimerRef.current) window.clearTimeout(animTimerRef.current);
      if (animSubTimerRef.current) window.clearTimeout(animSubTimerRef.current);

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

      const speedConfig = OWARE_SPEED_PROFILES[sowingSpeed] || OWARE_SPEED_PROFILES.slow;
      const stride = steps.length > 140 ? Math.ceil(steps.length / 120) : 1;
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
            // onMatchComplete fires from the winner effect, once per result.
          }
          return;
        }

        const currentFrame = sampledSteps[cursor];
        const pitCoords = getPitCenterInsideBoard(currentFrame.activePit);

        // PHASE 1: Smoothly glide the hand to the target bowl BEFORE dropping/scooping the seed
        setHandPose((prev) => ({
          visible: true,
          x: pitCoords.x,
          y: pitCoords.y,
          widthPx: pitCoords.widthPx,
          isTopPlayer,
          isInstant: false,
          isPulsing: false,
          seedCount: prev.seedCount,
        }));

        // PHASE 2: Once the hand arrives at the bowl, scoop/drop the seed, play sound, and pause clearly
        animSubTimerRef.current = window.setTimeout(() => {
          setAnimStep(currentFrame);
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
          }, Math.min(260, speedConfig.dropPauseMs));

          if (!muted) {
            if (currentFrame.harvestedPit !== undefined) {
              playSuccessSound();
              triggerHapticSensor("pocket_drop");
            } else {
              playWoodSeedClack(cursor);
              triggerHapticSensor("seed_drop");
            }
          }

          // Extra human pause when scooping the starting bowl, scooping a relay bowl, or harvesting 4 seeds
          const extraPause =
            currentFrame.type === "pickup" ||
            currentFrame.harvestedPit !== undefined ||
            currentFrame.isRelayScoop
              ? speedConfig.scoopBonusPauseMs
              : 0;

          cursor += 1;
          animTimerRef.current = window.setTimeout(
            tick,
            speedConfig.dropPauseMs + extraPause
          );
        }, speedConfig.moveMs);
      };

      animTimerRef.current = window.setTimeout(tick, 180);
    },
    [
      muted,
      mySide,
      sowingSpeed,
      getPitCenterInsideBoard,
      getHandRestPosition,
      onStateChange,
      onPointsEarned,
    ]
  );

  // Keep synced with external realtime board_state updates in P2P mode (and animate the opponent's move!)
  useEffect(() => {
    if (
      !serverChecked &&
      !isAnimating &&
      initialState &&
      Array.isArray(initialState.pits) &&
      initialState.pits.length === 12 &&
      ((initialState.moveCount || 0) > (game.moveCount || 0) ||
        Boolean(initialState.winner && !game.winner) ||
        ((initialState.moveCount || 0) === (game.moveCount || 0) &&
          initialState.turn &&
          initialState.turn !== game.turn))
    ) {
      const incomingMoveCount = initialState.moveCount || 0;
      const currentMoveCount = game.moveCount || 0;
      const lastMovePit = initialState.lastMove?.pit;
      const lastMovePlayer = initialState.lastMove?.player;

      if (
        incomingMoveCount === currentMoveCount + 1 &&
        typeof lastMovePit === "number" &&
        lastMovePlayer &&
        lastMovePlayer !== mySide
      ) {
        const activeVariant = initialState.variant || game.variant || "nam-nam";
        const sim =
          activeVariant === "nam-nam"
            ? simulateNamNamMoveWithSteps(game, lastMovePit, lastMovePlayer, true)
            : simulateAbapaMoveWithSteps(game, lastMovePit, lastMovePlayer, true);
        if (sim && sim.steps.length > 0) {
          playAnimatedMove(
            sim.steps,
            { variant: activeVariant, ...initialState },
            false,
            lastMovePlayer
          );
          return;
        }
      }

      setGame({ variant: game.variant || "nam-nam", ...initialState });
    }
  }, [
    initialState,
    game,
    isAnimating,
    mySide,
    playAnimatedMove,
    serverChecked,
  ]);

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

  const handleSelectSowingSpeed = (nextSpeed: OwareSowingSpeed) => {
    setSowingSpeed(nextSpeed);
    try {
      localStorage.setItem("swiftdata_oware_speed_v2", nextSpeed);
    } catch {
      // ignore
    }
  };

  const handlePitClick = useCallback(
    (pitIndex: number) => {
      if (game.winner || isAnimating || serverReply) return;
      // Strict turn order: nobody may move out of turn (previously either
      // player could make the opening move of a P2P match).
      if (game.turn !== mySide) return;

      const simResult =
        variant === "nam-nam"
          ? simulateNamNamMoveWithSteps(game, pitIndex, mySide, true)
          : simulateAbapaMoveWithSteps(game, pitIndex, mySide, true);

      if (!simResult) return;

      if (serverChecked && onServerMove) {
        // Animate immediately (same engine as the server); the server's reply
        // supplies the AI's moves and the authoritative board.
        setServerReply({ aiMoves: [], board: null });
        setServerError(null);
        onServerMove(pitIndex, variant)
          .then((res) => {
            if (res.ok && res.board) {
              setServerReply({ aiMoves: res.aiMoves || [], board: res.board });
            } else {
              setServerError(res.error || "Move could not be confirmed. Board re-synced.");
              setServerReply({ aiMoves: [], board: res.board || null });
            }
          })
          .catch(() => {
            setServerError("Connection problem. Your move was not confirmed; board re-synced.");
            setServerReply({ aiMoves: [], board: null });
          });
        playAnimatedMove(simResult.steps, simResult.nextState, false, mySide);
        return;
      }

      playAnimatedMove(simResult.steps, simResult.nextState, true, mySide);
    },
    [game, isAnimating, mySide, variant, playAnimatedMove, serverChecked, onServerMove, serverReply]
  );

  // Server-checked matches: play back the AI replies the server chose, then
  // snap to the server's board (it is the source of truth).
  useEffect(() => {
    if (!serverChecked || !serverReply || isAnimating) return;
    if (serverReply.aiMoves.length > 0 && game.turn === "opponent" && !game.winner) {
      const [aiPit, ...remaining] = serverReply.aiMoves;
      const sim =
        variant === "nam-nam"
          ? simulateNamNamMoveWithSteps(game, aiPit, "opponent", true)
          : simulateAbapaMoveWithSteps(game, aiPit, "opponent", true);
      setServerReply({ ...serverReply, aiMoves: remaining });
      if (sim) {
        const delay = (OWARE_SPEED_PROFILES[sowingSpeed] || OWARE_SPEED_PROFILES.normal).aiDelayMs / 2;
        const t = window.setTimeout(() => playAnimatedMove(sim.steps, sim.nextState, false, "opponent"), delay);
        return () => window.clearTimeout(t);
      }
      return;
    }
    if (serverReply.board === null && serverReply.aiMoves.length === 0 && !serverError) return; // still waiting
    if (serverReply.board) {
      const b = serverReply.board;
      const same =
        b.pits.join(",") === game.pits.join(",") &&
        b.scores.creator === game.scores.creator &&
        b.scores.opponent === game.scores.opponent &&
        b.turn === game.turn &&
        (b.winner || null) === (game.winner || null);
      if (!same) setGame({ variant, ...b });
    }
    setServerReply(null);
  }, [serverChecked, serverReply, serverError, isAnimating, game, variant, sowingSpeed, playAnimatedMove]);

  // Trigger Human-Sense Challenger move when playing vs Challenger / Free Data mode
  useEffect(() => {
    if (
      !serverChecked &&
      !isAnimating &&
      (mode === "ai" || mode === "free_data") &&
      !game.winner &&
      game.turn === "opponent"
    ) {
      const speedConfig = OWARE_SPEED_PROFILES[sowingSpeed] || OWARE_SPEED_PROFILES.normal;
      const humanDelay = speedConfig.aiDelayMs + Math.floor(Math.random() * 520);
      const timer = window.setTimeout(() => {
        const aiPit = chooseOwareAiMove(game, { difficulty: aiDifficulty, aiSide: "opponent" });
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
  }, [serverChecked, mode, game, isAnimating, variant, aiDifficulty, sowingSpeed, playAnimatedMove]);

  // Display state (either live animation frame or settled game state)
  const displayPits = animStep ? animStep.pits : game.pits;
  const displayScores = animStep ? animStep.scores : game.scores;
  const activeSideForLegalMoves =
    mode === "p2p" && (game.moveCount || 0) === 0 ? mySide : game.turn;
  const legalMovesForTurn =
    !game.winner && !isAnimating
      ? getLegalOwareMoves(game, activeSideForLegalMoves)
      : [];
  const otherSide: "creator" | "opponent" = game.turn === "creator" ? "opponent" : "creator";
  const mustFeedOpponent = !game.winner && sumSeedsOnSide(game.pits, otherSide) === 0;

  // Auto-finish when the player to move has no legal move (same rule the server applies)
  useEffect(() => {
    if (game.winner || isAnimating || serverReply) return;
    const settled = settleIfNoLegalMoves(game);
    if (settled !== game) {
      setGame(settled);
      if (!serverChecked) onStateChange?.(settled);
    }
  }, [game, isAnimating, onStateChange, serverChecked, serverReply]);

  const handleInBoardRematch = useCallback(() => {
    setDismissedWinnerPopup(false);
    notifiedWinnerRef.current = null;
    if (onRematch) {
      onRematch();
      if (mode !== "p2p") {
        const fresh: OwareState = { ...INITIAL_OWARE_STATE, variant };
        setGame(fresh);
        onStateChange?.(fresh);
      }
      return;
    }
    const fresh: OwareState = { ...INITIAL_OWARE_STATE, variant };
    setGame(fresh);
    onStateChange?.(fresh);
  }, [onRematch, mode, variant, onStateChange]);

  const winnerDisplayName =
    game.winner === "creator"
      ? creatorName
      : game.winner === "opponent"
      ? effectiveOpponentName
      : "24–24 Tie";
  const loserDisplayName =
    game.winner === "creator"
      ? effectiveOpponentName
      : game.winner === "opponent"
      ? creatorName
      : "";
  const didIWin = Boolean(game.winner && game.winner === mySide);
  const isDrawResult = game.winner === "draw";

  // Top row (North: Opponent pits 11 down to 6 left-to-right so counter-clockwise flow is visually accurate)
  const northIndices = [11, 10, 9, 8, 7, 6];
  // Bottom row (South: Creator pits 0 up to 5 left-to-right)
  const southIndices = [0, 1, 2, 3, 4, 5];

  const isMyTurn =
    !game.winner &&
    !isAnimating &&
    (game.turn === mySide || (mode === "p2p" && (game.moveCount || 0) === 0));

  // Shared Terracotta Carved Bowl styling matching the reference photo
  const terracottaBowlStyle = {
    background:
      "radial-gradient(circle at 36% 30%, #e06d34 0%, #c64f18 48%, #8e2e07 82%, #4a1502 100%)",
    boxShadow:
      "inset 0 8px 16px rgba(0,0,0,0.75), inset 0 -3px 8px rgba(251,146,60,0.28), 0 2px 6px rgba(0,0,0,0.9)",
  };

  const screenFit = useDeviceScreenFit();
  const owareFit = screenFit.computeBoardStageMetrics("oware", { reservedTopPx: 38 });

  return (
    <div className="space-y-2 sm:space-y-3 max-w-4xl mx-auto">
      {/* Top Status, Device Auto-Fit Badge, Rule Variant Selector & Score Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:p-3 rounded-2xl bg-slate-900/95 border border-amber-500/30 shadow-lg">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <img
            src="/oware-challenge-icon.jpg"
            alt="Ghanaian Oware Board"
            className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg object-cover shadow-md border border-amber-500/40"
          />
          <Badge className="bg-gradient-to-r from-orange-600 to-amber-500 text-white font-black text-[10px] sm:text-xs px-2 py-0.5">
            🪨 OWARE ({variant === "nam-nam" ? "NAM-NAM" : "ABAPA"})
          </Badge>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${owareFit.owarePitSizePx}px bowls)`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[9px] font-mono font-bold text-sky-300"
          >
            📱 {owareFit.fitSummaryLabel}
          </span>
          {mode !== "p2p" && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[9px] font-bold gap-1 hidden sm:inline-flex"
            >
              <Brain className="w-2.5 h-2.5" />
              {effectiveOpponentName} • {persona.humanSensePercent}% AI
            </Badge>
          )}

          {/* Rule Variant Switcher (Available before first move) */}
          <div className="inline-flex items-center rounded-xl bg-slate-950 p-0.5 border border-white/10">
            <button
              type="button"
              disabled={isAnimating || (game.moveCount || 0) > 0}
              onClick={() => handleToggleVariant("nam-nam")}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all ${
                variant === "nam-nam"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-white disabled:opacity-40"
              }`}
              title="Traditional Ghanaian Relay Sowing & 4-Seed Harvest"
            >
              🇬🇭 Nam-Nam
            </button>
            <button
              type="button"
              disabled={isAnimating || (game.moveCount || 0) > 0}
              onClick={() => handleToggleVariant("abapa")}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all ${
                variant === "abapa"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-white disabled:opacity-40"
              }`}
              title="Tournament Single-Lap & 2/3 Seed Capture"
            >
              🏆 Abapa
            </button>
          </div>

          {mode !== "p2p" && !serverChecked && (
            <select
              aria-label="Computer difficulty"
              value={aiDifficulty}
              onChange={(e) => {
                const next = e.target.value as OwareDifficulty;
                setAiDifficulty(next);
                try {
                  localStorage.setItem("swiftdata_oware_difficulty_v1", next);
                } catch {
                  // ignore
                }
              }}
              className="h-6 rounded-xl bg-slate-950 border border-white/15 px-1.5 text-[10px] font-black text-amber-300"
            >
              {(Object.keys(OWARE_DIFFICULTY_PROFILES) as OwareDifficulty[]).map((d) => (
                <option key={d} value={d}>
                  {OWARE_DIFFICULTY_PROFILES[d].label}
                </option>
              ))}
            </select>
          )}
          {serverChecked && (
            <span
              className="h-6 inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 border border-emerald-400/40 px-2 text-[10px] font-black text-emerald-300"
              title="Every move is checked by the server and the AI plays on the server, so results can't be faked."
            >
              ✓ Verified match
            </span>
          )}

          {/* Sowing Speed Selector (Slow / Normal / Fast) */}
          <div
            className="inline-flex items-center rounded-xl bg-slate-950 p-0.5 border border-emerald-500/30"
            title="Adjust Oware hand & seed sowing speed"
          >
            {(["slow", "normal", "fast"] as const).map((spKey) => (
              <button
                key={spKey}
                type="button"
                onClick={() => handleSelectSowingSpeed(spKey)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                  sowingSpeed === spKey
                    ? "bg-emerald-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {OWARE_SPEED_PROFILES[spKey].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* 🎙️ LIVE IN-GAME OPEN MIC VOICE CHAT */}
          <InGameVoiceChat
            roomCode={roomCode || "OWARE"}
            challengeId={challengeId}
            mySide={mySide}
            myName={mySide === "creator" ? creatorName : effectiveOpponentName}
            opponentName={mySide === "creator" ? effectiveOpponentName : creatorName}
            mode={mode}
          />

          {/* 🔄 1-Tap Rematch Button Directly on Oware Board */}
          <Button
            type="button"
            size="sm"
            onClick={handleInBoardRematch}
            className="h-7 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] gap-1 cursor-pointer shadow"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Rematch</span>
          </Button>

          {/* 🎮 1-Tap Play Another Game Button Directly on Oware Board */}
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
            className="h-7 px-2 text-[10px] text-amber-300 hover:text-amber-200 gap-1"
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
            className={`h-7 px-1.5 text-xs gap-1 ${
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
            className="h-7 w-7 p-0 text-amber-300"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
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
      <div className="relative p-2 sm:p-4 rounded-[28px] sm:rounded-[36px] bg-slate-950/90 border border-white/10 shadow-2xl space-y-2">
        {/* DIRECT ON-BOARD VOICE, SPEED & REMATCH CONTROL DOCK (Always visible right on the Oware board) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-2xl bg-slate-900/95 border border-amber-500/35 shadow-md">
          <div className="flex flex-wrap items-center gap-1.5">
            <InGameVoiceChat
              roomCode={roomCode || "OWARE"}
              challengeId={challengeId}
              mySide={mySide}
              myName={mySide === "creator" ? creatorName : effectiveOpponentName}
              opponentName={mySide === "creator" ? effectiveOpponentName : creatorName}
              mode={mode}
            />
            <div className="inline-flex items-center rounded-xl bg-slate-950 p-0.5 border border-emerald-500/40">
              {(["slow", "normal", "fast"] as const).map((spKey) => (
                <button
                  key={`board-speed-${spKey}`}
                  type="button"
                  onClick={() => handleSelectSowingSpeed(spKey)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                    sowingSpeed === spKey
                      ? "bg-emerald-500 text-slate-950 shadow"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {OWARE_SPEED_PROFILES[spKey].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleInBoardRematch}
              className="h-7 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] flex items-center gap-1 cursor-pointer shadow"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Rematch</span>
            </button>
            {onPlayAnotherGame && (
              <button
                type="button"
                onClick={onPlayAnotherGame}
                className="h-7 px-2.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 font-black text-[10px] flex items-center gap-1 cursor-pointer"
              >
                <Gamepad2 className="w-3 h-3" />
                <span>Play Another</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-8 gap-2 sm:gap-3.5 items-center">
          {/* Opponent Kulo Storehouse (Left Ebony Bowl) */}
          <div
            className={`flex lg:flex-col items-center justify-between lg:justify-center px-3 py-1.5 sm:p-3.5 rounded-[22px] sm:rounded-[36px] border-2 transition-all shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[54px] lg:min-h-[230px] ${
              animStep?.harvestedBy === "opponent"
                ? "border-amber-400 ring-4 ring-amber-400/30 scale-[1.03]"
                : "border-[#35373d]"
            }`}
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-left lg:text-center lg:mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-orange-300 truncate max-w-[130px] lg:max-w-[115px]">
                {effectiveOpponentName}
              </p>
              <p className="text-xl sm:text-3xl font-black text-white font-mono leading-tight">
                {displayScores.opponent}
                <span className="text-xs text-slate-400">/25</span>
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center shrink-0"
              style={terracottaBowlStyle}
            >
              <NickernutSeedCluster count={displayScores.opponent} pitSeedOffset={20} />
            </div>
          </div>

          {/* TWO HINGED MATTE-BLACK EBONY PLANKS WITH BRASS HINGES, 12 TERRACOTTA BOWLS & ANIMATED SOWING HAND */}
          <div ref={boardPlanksRef} className="lg:col-span-6 relative space-y-1.5">
            <OwareAnimatedHand
              {...handPose}
              moveDurationMs={(OWARE_SPEED_PROFILES[sowingSpeed] || OWARE_SPEED_PROFILES.normal).moveMs}
            />

            {/* TOP EBONY PLANK — Opponent's 6 Carved Terracotta Bowls (North: 11..6) */}
            <div
              className="relative px-2.5 sm:px-6 py-2.5 sm:py-4 rounded-[32px] sm:rounded-[64px] border-2 border-[#34363c] shadow-[0_14px_28px_rgba(0,0,0,0.9),inset_0_2px_4px_rgba(255,255,255,0.1)]"
              style={{
                background: "linear-gradient(180deg, #26272b 0%, #191a1d 55%, #121316 100%)",
              }}
            >
              <div className="flex items-center justify-between mb-1.5 px-2 sm:px-3">
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-orange-300/90">
                  ← {effectiveOpponentName}&apos;s Row (12 → 7)
                </span>
                {mySide === "opponent" && isMyTurn && (
                  <span className="text-[9px] sm:text-[10px] font-black text-emerald-400 animate-pulse">
                    Tap a bowl ↓
                  </span>
                )}
              </div>

              <div className="grid grid-cols-6 gap-1.5 sm:gap-3">
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
              className="relative px-2.5 sm:px-6 py-2.5 sm:py-4 rounded-[32px] sm:rounded-[64px] border-2 border-[#34363c] shadow-[0_16px_32px_rgba(0,0,0,0.95),inset_0_2px_4px_rgba(255,255,255,0.1)]"
              style={{
                background: "linear-gradient(180deg, #26272b 0%, #191a1d 55%, #121316 100%)",
              }}
            >
              <div className="grid grid-cols-6 gap-1.5 sm:gap-3">
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

              <div className="flex items-center justify-between mt-2 px-2 sm:px-3">
                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-orange-300/90">
                  {creatorName}&apos;s Row (1 → 6 {mySide === "creator" ? "• YOU" : ""}) →
                </span>
                {mySide === "creator" && isMyTurn && (
                  <span className="text-[9px] sm:text-[10px] font-black text-emerald-400 animate-pulse">
                    Tap a bowl ↑
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Creator Kulo Storehouse (Right Ebony Bowl) */}
          <div
            className={`flex lg:flex-col items-center justify-between lg:justify-center px-3 py-1.5 sm:p-3.5 rounded-[22px] sm:rounded-[36px] border-2 transition-all shadow-[0_14px_28px_rgba(0,0,0,0.85),inset_0_2px_3px_rgba(255,255,255,0.08)] min-h-[54px] lg:min-h-[230px] ${
              animStep?.harvestedBy === "creator"
                ? "border-emerald-400 ring-4 ring-emerald-400/30 scale-[1.03]"
                : "border-[#35373d]"
            }`}
            style={{
              background: "linear-gradient(180deg, #242529 0%, #17181b 55%, #101114 100%)",
            }}
          >
            <div className="text-left lg:text-center lg:mb-2">
              <p className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-400 truncate max-w-[130px] lg:max-w-[115px]">
                {creatorName}
              </p>
              <p className="text-xl sm:text-3xl font-black text-emerald-300 font-mono leading-tight">
                {displayScores.creator}
                <span className="text-xs text-slate-400">/25</span>
              </p>
              <span className="text-[9px] text-slate-400 font-semibold">Captured Seeds</span>
            </div>
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-full border-2 border-[#3a1a08] relative flex items-center justify-center shrink-0"
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

        {/* Quick Persistent Rematch Bar when Winner Popup is minimized */}
        {game.winner && dismissedWinnerPopup && (
          <div className="mt-3 p-3 rounded-2xl bg-gradient-to-r from-amber-500/20 via-slate-900 to-emerald-500/20 border border-amber-400/50 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-white">
                {isDrawResult
                  ? "🤝 24–24 Tie!"
                  : `🏆 Winner: ${winnerDisplayName} (${game.scores.creator} – ${game.scores.opponent})`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleInBoardRematch}
                className="h-8 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Request Rematch
              </Button>
              {onPlayAnotherGame && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onPlayAnotherGame}
                  className="h-8 rounded-xl border-sky-400/50 bg-sky-500/15 text-sky-200 font-black text-xs gap-1.5"
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  Play Another Game
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDismissedWinnerPopup(false)}
                className="h-8 rounded-xl text-amber-300 text-xs font-bold"
              >
                Show Winner Card
              </Button>
            </div>
          </div>
        )}

        {/* ── FULL WINNER SPOTLIGHT & REMATCH / PLAY ANOTHER GAME POPUP OVERLAY ── */}
        {game.winner && !dismissedWinnerPopup && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-md rounded-3xl bg-gradient-to-b from-slate-900 via-[#111827] to-slate-950 border-2 border-amber-400/70 shadow-[0_0_60px_rgba(245,158,11,0.35)] p-5 sm:p-6 text-center space-y-4 overflow-hidden">
              {/* Top Glow Ribbon + Live Post-Match Open Mic */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[11px] font-black uppercase tracking-wider">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Oware Match Finished • Winner Spotlight</span>
                </div>
                <InGameVoiceChat
                  roomCode={roomCode || "OWARE"}
                  challengeId={challengeId}
                  mySide={mySide}
                  myName={mySide === "creator" ? creatorName : effectiveOpponentName}
                  opponentName={mySide === "creator" ? effectiveOpponentName : creatorName}
                  mode={mode}
                />
              </div>

              {/* Winner Avatar & Trophy Spotlight */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 p-1 shadow-[0_0_35px_rgba(251,191,36,0.6)]">
                  <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                    <Trophy className="w-10 h-10 text-amber-400 animate-bounce" />
                  </div>
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-black text-[9px] uppercase tracking-wider shadow">
                    {isDrawResult ? "DRAW" : "WINNER"}
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
                  {isDrawResult
                    ? "🤝 24–24 Tie Game!"
                    : `🏆 ${winnerDisplayName} Wins!`}
                </h2>

                <p className="text-xs sm:text-sm text-slate-300 font-semibold max-w-xs mx-auto">
                  {isDrawResult
                    ? "Both players harvested 24 nickernut seeds each! Ready for a tie-breaker?"
                    : didIWin
                    ? `Congratulations! You defeated ${loserDisplayName} in Ghanaian Oware!`
                    : `${winnerDisplayName} captured the winning seeds this round. Request an instant rematch or switch to another game below!`}
                </p>

                {prizePoolGhs > 0 && !isDrawResult && (
                  <div className="px-4 py-1.5 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-black">
                    💰 Winner Payout: GH₵ {prizePoolGhs.toFixed(2)}
                  </div>
                )}
              </div>

              {/* Head-to-Head Final Seed Scoreboard */}
              <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-slate-950/90 border border-white/10">
                <div
                  className={`p-2.5 rounded-xl border ${
                    game.winner === "creator"
                      ? "bg-emerald-500/15 border-emerald-400/60"
                      : "bg-white/[0.03] border-white/10"
                  }`}
                >
                  <p className="text-[10px] font-black uppercase text-emerald-300 truncate">
                    {creatorName} {mySide === "creator" ? "(YOU)" : ""}
                  </p>
                  <p className="text-2xl font-black font-mono text-white mt-0.5">
                    {game.scores.creator}
                    <span className="text-xs text-slate-400"> seeds</span>
                  </p>
                  {game.winner === "creator" && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black">
                      👑 WINNER
                    </span>
                  )}
                </div>

                <div
                  className={`p-2.5 rounded-xl border ${
                    game.winner === "opponent"
                      ? "bg-amber-500/15 border-amber-400/60"
                      : "bg-white/[0.03] border-white/10"
                  }`}
                >
                  <p className="text-[10px] font-black uppercase text-orange-300 truncate">
                    {effectiveOpponentName} {mySide === "opponent" ? "(YOU)" : ""}
                  </p>
                  <p className="text-2xl font-black font-mono text-white mt-0.5">
                    {game.scores.opponent}
                    <span className="text-xs text-slate-400"> seeds</span>
                  </p>
                  {game.winner === "opponent" && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black">
                      👑 WINNER
                    </span>
                  )}
                </div>
              </div>

              {/* 1-Tap Action Buttons for Loser & Winner: Request Rematch or Play Another Game */}
              <div className="space-y-2 pt-1">
                <Button
                  type="button"
                  onClick={handleInBoardRematch}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-emerald-400 via-amber-400 to-orange-500 hover:from-emerald-300 hover:to-orange-400 text-slate-950 font-black text-sm shadow-lg gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>
                    {didIWin
                      ? `🔄 Play Rematch vs ${loserDisplayName || "Opponent"}`
                      : `🔄 Request Rematch vs ${winnerDisplayName}`}
                  </span>
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  {onPlayAnotherGame ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onPlayAnotherGame}
                      className="h-10 rounded-xl border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 font-black text-xs gap-1.5 cursor-pointer"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      <span>Play Another Game</span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleInBoardRematch}
                      className="h-10 rounded-xl border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 font-black text-xs gap-1.5 cursor-pointer"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      <span>New Match</span>
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDismissedWinnerPopup(true)}
                    className="h-10 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-xs gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>View Final Board</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
