import React, { useState, useEffect, useRef, useCallback } from "react";
import { Volume2, VolumeX, Smartphone, ChevronLeft, Share2, RotateCcw, Trophy } from "lucide-react";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import {
  playFruitSliceSound,
  playBombExplosionSound,
  playStallClearedSound,
  playLevelUpFanfare,
  triggerHapticSensor,
  getGameSensoryPreferences,
  setGameSensoryPreferences,
  HUMAN_CHALLENGER_PERSONAS,
} from "@/lib/game-sensory-engine";

export interface MarketSlashState {
  creatorScore: number;
  opponentScore: number;
  creatorLevel: number;
  creatorSliced: number;
  creatorBestCombo: number;
  creatorFinished: boolean;
  opponentFinished: boolean;
  turn: "creator" | "opponent";
  winner: "creator" | "opponent" | "draw" | null;
  moveCount: number;
}

export const INITIAL_SLASH_STATE: MarketSlashState = {
  creatorScore: 0,
  opponentScore: 0,
  creatorLevel: 1,
  creatorSliced: 0,
  creatorBestCombo: 1,
  creatorFinished: false,
  opponentFinished: false,
  turn: "creator",
  winner: null,
  moveCount: 0,
};

interface StallLevelConfig {
  level: number;
  name: string;
  subtitle: string;
  fruitsToClear: number;
  clearBonus: number;
  spawnIntervalMs: number;
  bombProbability: number;
  maxBatch: number;
}

const STALL_LEVELS: StallLevelConfig[] = [
  {
    level: 1,
    name: "Morning market",
    subtitle: "Warm up your blade",
    fruitsToClear: 10,
    clearBonus: 150,
    spawnIntervalMs: 1350,
    bombProbability: 0.12,
    maxBatch: 2,
  },
  {
    level: 2,
    name: "Busy stall",
    subtitle: "Faster hands needed",
    fruitsToClear: 14,
    clearBonus: 300,
    spawnIntervalMs: 1180,
    bombProbability: 0.18,
    maxBatch: 3,
  },
  {
    level: 3,
    name: "Rush hour",
    subtitle: "Watch for bombs in the crowd",
    fruitsToClear: 16,
    clearBonus: 450,
    spawnIntervalMs: 1050,
    bombProbability: 0.22,
    maxBatch: 3,
  },
  {
    level: 4,
    name: "Kejetia peak",
    subtitle: "Multi-fruit tosses incoming!",
    fruitsToClear: 18,
    clearBonus: 600,
    spawnIntervalMs: 950,
    bombProbability: 0.25,
    maxBatch: 4,
  },
  {
    level: 5,
    name: "Makola finale",
    subtitle: "Grand Market Master stage!",
    fruitsToClear: 22,
    clearBonus: 750,
    spawnIntervalMs: 880,
    bombProbability: 0.28,
    maxBatch: 4,
  },
];

type FruitKind = "watermelon" | "papaya" | "pineapple" | "bomb";

interface ActiveFruit {
  id: number;
  kind: FruitKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  vRot: number;
  sliced: boolean;
}

interface SlicedHalf {
  id: number;
  kind: Exclude<FruitKind, "bomb">;
  side: -1 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  vRot: number;
  alpha: number;
}

interface JuiceSplatter {
  id: number;
  x: number;
  y: number;
  color: string;
  radius: number;
  alpha: number;
  blobs: { dx: number; dy: number; r: number }[];
}

interface JuiceParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  isConfetti?: boolean;
}

interface FloatingPopup {
  id: number;
  x: number;
  y: number;
  text: string;
  subText?: string;
  color: string;
  alpha: number;
  vy: number;
  scale: number;
}

interface SwipePoint {
  x: number;
  y: number;
  time: number;
}

interface MarketSlashBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: MarketSlashState;
  onStateChange?: (nextState: MarketSlashState) => void;
  onMatchComplete?: (
    winnerSide: "creator" | "opponent" | "draw",
    finalState: MarketSlashState
  ) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
  onBackToLobby?: () => void;
}

export function MarketSlashBoard({
  mode,
  mySide,
  creatorName,
  opponentName,
  initialState,
  onStateChange,
  onMatchComplete,
  onPointsEarned,
  playerLevel = 1,
  onBackToLobby,
}: MarketSlashBoardProps) {
  const persona = HUMAN_CHALLENGER_PERSONAS.slash;
  const effectiveOpponentName =
    mode === "p2p"
      ? opponentName || "Challenger"
      : opponentName && !opponentName.toLowerCase().includes("ai")
      ? opponentName
      : persona.name;

  // Medium-difficulty Human-Sense target score for AI / Free Data opponent (scales slightly with level)
  const aiTargetScore = useRef<number>(
    Math.round(580 + Math.min(5, playerLevel) * 65 + (Math.random() * 90 - 45))
  );

  const [score, setScore] = useState<number>(0);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem("swiftdata_market_slash_best") || 0);
    } catch {
      return 0;
    }
  });
  const [stallIdx, setStallIdx] = useState<number>(0); // 0..4 (Levels 1..5)
  const [misses, setMisses] = useState<number>(0); // 0..3
  const [totalSliced, setTotalSliced] = useState<number>(0);
  const [bestCombo, setBestCombo] = useState<number>(1);
  const [gameOverReason, setGameOverReason] = useState<
    "bomb" | "missed" | "cleared_all" | null
  >(null);
  const [bannerOverlay, setBannerOverlay] = useState<{
    type: "level_intro" | "stall_cleared";
    level: number;
    title: string;
    subtitle: string;
    bonus?: number;
  } | null>({
    type: "level_intro",
    level: 1,
    title: STALL_LEVELS[0].name,
    subtitle: STALL_LEVELS[0].subtitle,
  });
  const [showSwipeHint, setShowSwipeHint] = useState<boolean>(true);
  const [muted, setMuted] = useState(() => !getGameSensoryPreferences().soundEnabled);
  const [vibrationEnabled, setVibrationEnabled] = useState(
    () => getGameSensoryPreferences().vibrationEnabled
  );
  const [copiedShare, setCopiedShare] = useState(false);

  // Mutable simulation refs for smooth 60fps canvas loop
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPointerDownRef = useRef<boolean>(false);
  const swipeTrailRef = useRef<SwipePoint[]>([]);
  const fruitsRef = useRef<ActiveFruit[]>([]);
  const halvesRef = useRef<SlicedHalf[]>([]);
  const splattersRef = useRef<JuiceSplatter[]>([]);
  const particlesRef = useRef<JuiceParticle[]>([]);
  const popupsRef = useRef<FloatingPopup[]>([]);
  const nextEntityIdRef = useRef<number>(1);

  const scoreRef = useRef<number>(0);
  const stallIdxRef = useRef<number>(0);
  const stallSlicedCountRef = useRef<number>(0);
  const totalSlicedRef = useRef<number>(0);
  const bestComboRef = useRef<number>(1);
  const missesRef = useRef<number>(0);
  const gameOverRef = useRef<"bomb" | "missed" | "cleared_all" | null>(null);
  const isPausedForBannerRef = useRef<boolean>(true);
  const lastSpawnTimeRef = useRef<number>(0);
  const recentSliceTimesRef = useRef<number[]>([]);
  const screenFlashAlphaRef = useRef<number>(0);
  const matchSettledRef = useRef<boolean>(false);

  // Dismiss initial Level 1 intro banner after 1.35s
  useEffect(() => {
    const t = window.setTimeout(() => {
      setBannerOverlay(null);
      isPausedForBannerRef.current = false;
      lastSpawnTimeRef.current = performance.now();
    }, 1350);
    return () => window.clearTimeout(t);
  }, []);

  const triggerEndGame = useCallback(
    (reason: "bomb" | "missed" | "cleared_all") => {
      if (gameOverRef.current) return;
      gameOverRef.current = reason;
      setGameOverReason(reason);

      const finalPts = scoreRef.current;
      setBestScore((prev) => {
        const nextBest = Math.max(prev, finalPts);
        try {
          window.localStorage.setItem("swiftdata_market_slash_best", String(nextBest));
        } catch {
          // ignore
        }
        return nextBest;
      });

      // Settle match if not already settled
      if (!matchSettledRef.current) {
        matchSettledRef.current = true;
        const oppScore =
          mode === "p2p"
            ? initialState?.opponentScore || 0
            : aiTargetScore.current;
        const winnerSide: "creator" | "opponent" | "draw" =
          finalPts > oppScore
            ? mySide
            : finalPts < oppScore
            ? mySide === "creator"
              ? "opponent"
              : "creator"
            : "draw";

        if (winnerSide === mySide) {
          playLevelUpFanfare();
          onPointsEarned?.(250, `Market Slash Victory (${finalPts} pts)`);
        }

        const nextState: MarketSlashState = {
          creatorScore: mySide === "creator" ? finalPts : initialState?.creatorScore || 0,
          opponentScore: mySide === "opponent" ? finalPts : oppScore,
          creatorLevel: stallIdxRef.current + 1,
          creatorSliced: totalSlicedRef.current,
          creatorBestCombo: bestComboRef.current,
          creatorFinished: true,
          opponentFinished: true,
          turn: "creator",
          winner: winnerSide,
          moveCount: (initialState?.moveCount || 0) + 1,
        };
        onStateChange?.(nextState);
        onMatchComplete?.(winnerSide, nextState);
      }
    },
    [initialState, mode, mySide, onMatchComplete, onPointsEarned, onStateChange]
  );

  const handleRestartGame = useCallback(() => {
    fruitsRef.current = [];
    halvesRef.current = [];
    splattersRef.current = [];
    particlesRef.current = [];
    popupsRef.current = [];
    swipeTrailRef.current = [];
    scoreRef.current = 0;
    stallIdxRef.current = 0;
    stallSlicedCountRef.current = 0;
    totalSlicedRef.current = 0;
    bestComboRef.current = 1;
    missesRef.current = 0;
    gameOverRef.current = null;
    screenFlashAlphaRef.current = 0;

    setScore(0);
    setStallIdx(0);
    setMisses(0);
    setTotalSliced(0);
    setBestCombo(1);
    setGameOverReason(null);
    setBannerOverlay({
      type: "level_intro",
      level: 1,
      title: STALL_LEVELS[0].name,
      subtitle: STALL_LEVELS[0].subtitle,
    });
    isPausedForBannerRef.current = true;

    window.setTimeout(() => {
      setBannerOverlay(null);
      isPausedForBannerRef.current = false;
      lastSpawnTimeRef.current = performance.now();
    }, 1200);
  }, []);

  const spawnFruitWave = useCallback((canvasWidth: number, canvasHeight: number) => {
    const config = STALL_LEVELS[stallIdxRef.current] || STALL_LEVELS[0];
    const count = 1 + Math.floor(Math.random() * config.maxBatch);
    const fruitTypes: Exclude<FruitKind, "bomb">[] = ["watermelon", "papaya", "pineapple"];

    let bombSpawnedInWave = false;
    for (let i = 0; i < count; i++) {
      const shouldBeBomb =
        !bombSpawnedInWave &&
        count >= 2 &&
        Math.random() < config.bombProbability;
      if (shouldBeBomb) bombSpawnedInWave = true;

      const kind: FruitKind = shouldBeBomb
        ? "bomb"
        : fruitTypes[Math.floor(Math.random() * fruitTypes.length)];

      const margin = 56;
      const x =
        margin +
        ((canvasWidth - margin * 2) * (i + 0.35 + Math.random() * 0.3)) /
          Math.max(1, count);
      const y = canvasHeight + 35 + i * 18;

      // Aim trajectory toward the upper-middle wood cutting board
      const targetX = canvasWidth * (0.28 + Math.random() * 0.44);
      const peakHeight = canvasHeight * (0.26 + Math.random() * 0.16);
      const gravity = 0.26;
      const dy = y - peakHeight;
      const vy = -Math.sqrt(2 * gravity * dy);
      const flightFrames = Math.abs(vy / gravity);
      const vx = (targetX - x) / Math.max(24, flightFrames);

      const radius =
        kind === "watermelon"
          ? 34
          : kind === "pineapple"
          ? 31
          : kind === "papaya"
          ? 29
          : 27;

      fruitsRef.current.push({
        id: nextEntityIdRef.current++,
        kind,
        x,
        y,
        vx,
        vy,
        radius,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.07,
        sliced: false,
      });
    }
  }, []);

  const addConfettiBurst = useCallback((cx: number, cy: number) => {
    const colors = ["#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#facc15"];
    for (let i = 0; i < 42; i++) {
      const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.25;
      const speed = 3 + Math.random() * 7.5;
      particlesRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        radius: 4 + Math.random() * 3,
        color: colors[i % colors.length],
        alpha: 1,
        isConfetti: true,
      });
    }
  }, []);

  const sliceFruit = useCallback(
    (fruit: ActiveFruit, canvasWidth: number, canvasHeight: number) => {
      if (fruit.sliced || gameOverRef.current) return;
      fruit.sliced = true;

      if (fruit.kind === "bomb") {
        playBombExplosionSound();
        screenFlashAlphaRef.current = 0.95;
        // Explosion particles
        for (let i = 0; i < 32; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2.5 + Math.random() * 8;
          particlesRef.current.push({
            x: fruit.x,
            y: fruit.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 3 + Math.random() * 4,
            color: i % 2 === 0 ? "#f97316" : "#facc15",
            alpha: 1,
          });
        }
        triggerEndGame("bomb");
        return;
      }

      // Compute combo within 320ms window
      const now = performance.now();
      recentSliceTimesRef.current = [
        ...recentSliceTimesRef.current.filter((t) => now - t < 320),
        now,
      ];
      const comboCount = recentSliceTimesRef.current.length;
      if (comboCount > bestComboRef.current) {
        bestComboRef.current = comboCount;
        setBestCombo(comboCount);
      }

      playFruitSliceSound(comboCount);

      const ptsAdded = comboCount >= 3 ? 20 : comboCount === 2 ? 15 : 10;
      scoreRef.current += ptsAdded;
      setScore(scoreRef.current);

      totalSlicedRef.current += 1;
      setTotalSliced(totalSlicedRef.current);

      // Award Arena progression points every 5 fruits sliced
      if (totalSlicedRef.current % 5 === 0) {
        onPointsEarned?.(25, "5 Market Fruits Sliced (+25 Arena Pts)");
      }

      const juiceColor =
        fruit.kind === "watermelon"
          ? "#ef4444"
          : fruit.kind === "papaya"
          ? "#f97316"
          : "#facc15";

      // 1. Add persistent juice splatter on the wooden cutting board
      const blobs = Array.from({ length: 7 }, () => ({
        dx: (Math.random() - 0.5) * fruit.radius * 1.9,
        dy: (Math.random() - 0.5) * fruit.radius * 1.9,
        r: 4 + Math.random() * 9,
      }));
      splattersRef.current.push({
        id: nextEntityIdRef.current++,
        x: fruit.x,
        y: Math.max(canvasHeight * 0.26, fruit.y),
        color: juiceColor,
        radius: fruit.radius * 0.85,
        alpha: 0.52,
        blobs,
      });
      if (splattersRef.current.length > 14) {
        splattersRef.current.shift();
      }

      // 2. Spawn two rotating fruit halves that separate cleanly
      ([-1, 1] as const).forEach((side) => {
        halvesRef.current.push({
          id: nextEntityIdRef.current++,
          kind: fruit.kind as Exclude<FruitKind, "bomb">,
          side,
          x: fruit.x + side * 8,
          y: fruit.y,
          vx: fruit.vx + side * (2.2 + Math.random() * 1.2),
          vy: Math.min(-1.5, fruit.vy * 0.55),
          radius: fruit.radius,
          rotation: fruit.rotation + side * 0.25,
          vRot: side * (0.06 + Math.random() * 0.04),
          alpha: 1,
        });
      });

      // 3. Flying juice droplets
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.8 + Math.random() * 5.2;
        particlesRef.current.push({
          x: fruit.x,
          y: fruit.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          radius: 2.5 + Math.random() * 3.5,
          color: juiceColor,
          alpha: 0.95,
        });
      }

      // 4. Floating +10 / COMBO popup
      popupsRef.current.push({
        id: nextEntityIdRef.current++,
        x: fruit.x,
        y: fruit.y - 12,
        text: comboCount >= 2 ? `COMBO ${comboCount}x! +${ptsAdded}` : `+${ptsAdded}`,
        color: comboCount >= 2 ? "#facc15" : "#ffffff",
        alpha: 1,
        vy: -1.6,
        scale: comboCount >= 2 ? 1.2 : 1,
      });

      // 5. Check if current Market Stall level is cleared!
      stallSlicedCountRef.current += 1;
      const currentStall = STALL_LEVELS[stallIdxRef.current];
      if (
        currentStall &&
        stallSlicedCountRef.current >= currentStall.fruitsToClear &&
        !isPausedForBannerRef.current
      ) {
        isPausedForBannerRef.current = true;
        fruitsRef.current = []; // Clear remaining airborne hazards cleanly
        const bonus = currentStall.clearBonus;
        scoreRef.current += bonus;
        setScore(scoreRef.current);

        playStallClearedSound();
        addConfettiBurst(canvasWidth / 2, canvasHeight * 0.52);
        onPointsEarned?.(60, `Stall ${currentStall.level} Cleared (+60 Arena Pts)`);

        setBannerOverlay({
          type: "stall_cleared",
          level: currentStall.level,
          title: "STALL CLEARED!",
          subtitle: currentStall.name,
          bonus,
        });

        window.setTimeout(() => {
          if (gameOverRef.current) return;
          const nextIdx = stallIdxRef.current + 1;
          if (nextIdx >= STALL_LEVELS.length) {
            setBannerOverlay(null);
            triggerEndGame("cleared_all");
            return;
          }
          stallIdxRef.current = nextIdx;
          stallSlicedCountRef.current = 0;
          setStallIdx(nextIdx);
          const nextStall = STALL_LEVELS[nextIdx];
          setBannerOverlay({
            type: "level_intro",
            level: nextStall.level,
            title: nextStall.name,
            subtitle: nextStall.subtitle,
          });

          window.setTimeout(() => {
            if (gameOverRef.current) return;
            setBannerOverlay(null);
            isPausedForBannerRef.current = false;
            lastSpawnTimeRef.current = performance.now();
          }, 1350);
        }, 1450);
      }
    },
    [addConfettiBurst, onPointsEarned, triggerEndGame]
  );

  // Check line-segment to circle intersection for responsive blade slicing
  const checkSwipeCollisions = useCallback(
    (x1: number, y1: number, x2: number, y2: number, canvasW: number, canvasH: number) => {
      if (gameOverRef.current || isPausedForBannerRef.current) return;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const segLenSq = dx * dx + dy * dy;

      for (const fruit of fruitsRef.current) {
        if (fruit.sliced) continue;
        let t = 0;
        if (segLenSq > 0.0001) {
          t = ((fruit.x - x1) * dx + (fruit.y - y1) * dy) / segLenSq;
          t = Math.max(0, Math.min(1, t));
        }
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;
        const dist = Math.hypot(fruit.x - closestX, fruit.y - closestY);
        if (dist <= fruit.radius + 10) {
          sliceFruit(fruit, canvasW, canvasH);
        }
      }
    },
    [sliceFruit]
  );

  // Pointer / Touch event handlers on the playfield canvas
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, w: 420, h: 560 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      w: canvas.width,
      h: canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gameOverRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    if (showSwipeHint) setShowSwipeHint(false);

    const pt = getCanvasPoint(e);
    const now = performance.now();
    swipeTrailRef.current = [{ x: pt.x, y: pt.y, time: now }];
    checkSwipeCollisions(pt.x, pt.y, pt.x, pt.y, pt.w, pt.h);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current || gameOverRef.current) return;
    const pt = getCanvasPoint(e);
    const now = performance.now();
    const trail = swipeTrailRef.current;
    const prev = trail.length > 0 ? trail[trail.length - 1] : { x: pt.x, y: pt.y, time: now };
    trail.push({ x: pt.x, y: pt.y, time: now });
    if (trail.length > 18) trail.shift();
    checkSwipeCollisions(prev.x, prev.y, pt.x, pt.y, pt.w, pt.h);
  };

  const handlePointerUp = () => {
    isPointerDownRef.current = false;
  };

  // Main 60fps Canvas Render & Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;

    const drawGhanaianMarketHeader = (w: number, marketH: number) => {
      // Warm morning sky backdrop
      const skyGrad = ctx.createLinearGradient(0, 0, 0, marketH);
      skyGrad.addColorStop(0, "#7dd3fc");
      skyGrad.addColorStop(0.65, "#bae6fd");
      skyGrad.addColorStop(1, "#fed7aa");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, marketH);

      // Distant utility wire
      ctx.strokeStyle = "rgba(30,41,59,0.28)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.quadraticCurveTo(w * 0.5, 28, w, 12);
      ctx.stroke();

      // 4 Colorful Ghanaian Market Stalls (Yellow, Blue, Pink/Red, Orange)
      const stalls = [
        { x: 6, width: w * 0.24, wall: "#fde047", roof1: "#16a34a", roof2: "#86efac" },
        { x: w * 0.255, width: w * 0.23, wall: "#38bdf8", roof1: "#0284c7", roof2: "#bae6fd" },
        { x: w * 0.5, width: w * 0.24, wall: "#fb7185", roof1: "#e11d48", roof2: "#fecdd3" },
        { x: w * 0.755, width: w * 0.23, wall: "#fb923c", roof1: "#ea580c", roof2: "#fed7aa" },
      ];

      const sidewalkY = marketH - 18;
      stalls.forEach((s) => {
        const stallTop = 26;
        const stallHeight = sidewalkY - stallTop;
        // Shopfront wall
        ctx.fillStyle = s.wall;
        ctx.fillRect(s.x, stallTop + 14, s.width, stallHeight - 14);

        // Dark interior counter window
        ctx.fillStyle = "#3b2314";
        ctx.fillRect(s.x + 8, stallTop + 22, s.width - 16, stallHeight * 0.42);

        // Striped market awning
        const stripes = 5;
        const sw = s.width / stripes;
        for (let i = 0; i < stripes; i++) {
          ctx.fillStyle = i % 2 === 0 ? s.roof1 : s.roof2;
          ctx.beginPath();
          ctx.rect(s.x + i * sw, stallTop, sw, 16);
          ctx.fill();
        }

        // Woven baskets & produce crates in front of stall
        ctx.fillStyle = "#a16207";
        ctx.beginPath();
        ctx.roundRect(s.x + 10, sidewalkY - 18, s.width * 0.38, 16, 4);
        ctx.roundRect(s.x + s.width * 0.52, sidewalkY - 16, s.width * 0.36, 14, 4);
        ctx.fill();

        // Colorful stacked fruits in baskets
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(s.x + 18, sidewalkY - 19, 5, 0, Math.PI * 2);
        ctx.arc(s.x + 27, sidewalkY - 20, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#f97316";
        ctx.beginPath();
        ctx.arc(s.x + s.width * 0.62, sidewalkY - 18, 4.5, 0, Math.PI * 2);
        ctx.arc(s.x + s.width * 0.72, sidewalkY - 18, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Stone sidewalk & dark divider border
      ctx.fillStyle = "#d6d3d1";
      ctx.fillRect(0, sidewalkY, w, 18);
      ctx.fillStyle = "#29180d";
      ctx.fillRect(0, marketH - 4, w, 4);
    };

    const drawWoodenCuttingBoard = (w: number, h: number, marketH: number) => {
      const boardY = marketH;
      const boardH = h - marketH;

      const woodGrad = ctx.createLinearGradient(0, boardY, 0, h);
      woodGrad.addColorStop(0, "#7c4a27");
      woodGrad.addColorStop(0.5, "#6b3e1f");
      woodGrad.addColorStop(1, "#542f16");
      ctx.fillStyle = woodGrad;
      ctx.fillRect(0, boardY, w, boardH);

      // Horizontal wood planks & grain lines (matching game_play_2_.mp4)
      const plankCount = 7;
      const plankH = boardH / plankCount;
      for (let i = 0; i < plankCount; i++) {
        const py = boardY + i * plankH;
        // Plank seam
        ctx.strokeStyle = "rgba(32, 16, 6, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();

        // Subtle warm highlight below seam
        ctx.strokeStyle = "rgba(251, 191, 36, 0.08)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, py + 2);
        ctx.lineTo(w, py + 2);
        ctx.stroke();

        // Wood grain curves
        ctx.strokeStyle = "rgba(45, 22, 8, 0.24)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, py + plankH * 0.38);
        ctx.bezierCurveTo(
          w * 0.3,
          py + plankH * 0.24,
          w * 0.7,
          py + plankH * 0.56,
          w,
          py + plankH * 0.35
        );
        ctx.stroke();

        // Occasional natural wood knot
        if (i % 2 === 1) {
          const kx = ((i * 137) % (w - 90)) + 45;
          const ky = py + plankH * 0.52;
          ctx.strokeStyle = "rgba(38, 18, 7, 0.32)";
          ctx.beginPath();
          ctx.ellipse(kx, ky, 14, 6, 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    const drawWholeFruitOrBomb = (f: ActiveFruit) => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rotation);

      // Soft drop shadow on the board
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.arc(4, 7, f.radius * 0.96, 0, Math.PI * 2);
      ctx.fill();

      if (f.kind === "watermelon") {
        // Deep green watermelon with wavy dark-green stripes
        const g = ctx.createRadialGradient(
          -f.radius * 0.3,
          -f.radius * 0.3,
          4,
          0,
          0,
          f.radius
        );
        g.addColorStop(0, "#4ade80");
        g.addColorStop(0.55, "#16a34a");
        g.addColorStop(1, "#14532d");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, f.radius * 1.06, f.radius * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark green stripes
        ctx.strokeStyle = "#052e16";
        ctx.lineWidth = 3.2;
        [-0.5, 0, 0.5].forEach((offset) => {
          ctx.beginPath();
          ctx.arc(0, offset * f.radius * 0.45, f.radius * 0.85, -0.55, 0.55);
          ctx.stroke();
        });

        // Glossy highlight
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.ellipse(-f.radius * 0.32, -f.radius * 0.32, 8, 4, -0.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === "papaya") {
        // Golden-orange Ghanaian Papaya (Pawpaw)
        const g = ctx.createRadialGradient(
          -f.radius * 0.25,
          -f.radius * 0.3,
          4,
          0,
          0,
          f.radius
        );
        g.addColorStop(0, "#fde047");
        g.addColorStop(0.5, "#f97316");
        g.addColorStop(1, "#c2410c");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, f.radius * 0.88, f.radius * 1.12, 0, 0, Math.PI * 2);
        ctx.fill();

        // Subtle green tip
        ctx.fillStyle = "#65a30d";
        ctx.beginPath();
        ctx.arc(0, -f.radius * 1.06, 5, 0, Math.PI * 2);
        ctx.fill();

        // Glossy sheen
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.beginPath();
        ctx.ellipse(-f.radius * 0.26, -f.radius * 0.3, 6, 11, -0.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === "pineapple") {
        // Spiky green crown leaves
        ctx.fillStyle = "#15803d";
        [-0.45, -0.2, 0, 0.2, 0.45].forEach((ang, i) => {
          ctx.save();
          ctx.translate(0, -f.radius * 0.82);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(-5, 0);
          ctx.lineTo(0, -16 - (i % 2) * 5);
          ctx.lineTo(5, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        });

        // Golden-brown pineapple body
        const g = ctx.createRadialGradient(-6, -6, 4, 0, 0, f.radius);
        g.addColorStop(0, "#facc15");
        g.addColorStop(0.65, "#d97706");
        g.addColorStop(1, "#78350f");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 4, f.radius * 0.84, f.radius * 0.96, 0, 0, Math.PI * 2);
        ctx.fill();

        // Crisscross diamond texture
        ctx.strokeStyle = "rgba(120,53,15,0.55)";
        ctx.lineWidth = 1.4;
        for (let d = -12; d <= 12; d += 8) {
          ctx.beginPath();
          ctx.moveTo(d - 10, -10);
          ctx.lineTo(d + 10, 16);
          ctx.moveTo(d + 10, -10);
          ctx.lineTo(d - 10, 16);
          ctx.stroke();
        }
      } else if (f.kind === "bomb") {
        // Cast-iron matte black bomb with burning spark fuse
        const g = ctx.createRadialGradient(-8, -8, 3, 0, 0, f.radius);
        g.addColorStop(0, "#475569");
        g.addColorStop(0.45, "#1e293b");
        g.addColorStop(1, "#020617");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, f.radius, 0, Math.PI * 2);
        ctx.fill();

        // Subtle danger rim
        ctx.strokeStyle = "rgba(239,68,68,0.5)";
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Brass fuse collar
        ctx.fillStyle = "#b45309";
        ctx.fillRect(-5, -f.radius - 4, 10, 6);

        // Curved rope fuse
        ctx.strokeStyle = "#d6d3d1";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -f.radius - 4);
        ctx.quadraticCurveTo(8, -f.radius - 16, 14, -f.radius - 12);
        ctx.stroke();

        // Flickering bright orange-yellow spark at fuse tip
        const sparkR = 5 + Math.sin(performance.now() * 0.04) * 2.5;
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.arc(14, -f.radius - 12, sparkR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(14, -f.radius - 12, sparkR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawSlicedFruitHalf = (h: SlicedHalf) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, h.alpha);
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rotation);

      const startAngle = h.side === -1 ? Math.PI * 0.5 : -Math.PI * 0.5;
      const endAngle = h.side === -1 ? Math.PI * 1.5 : Math.PI * 0.5;

      // Outer rind arc
      ctx.fillStyle =
        h.kind === "watermelon"
          ? "#15803d"
          : h.kind === "papaya"
          ? "#ea580c"
          : "#b45309";
      ctx.beginPath();
      ctx.arc(0, 0, h.radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      // Inner juicy flesh arc
      ctx.fillStyle =
        h.kind === "watermelon"
          ? "#ef4444"
          : h.kind === "papaya"
          ? "#fb923c"
          : "#fde047";
      ctx.beginPath();
      ctx.arc(0, 0, h.radius * 0.82, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      // Seeds detail inside watermelon or papaya
      ctx.fillStyle = "#1c1917";
      if (h.kind === "watermelon") {
        [-10, 0, 10].forEach((sy) => {
          ctx.beginPath();
          ctx.arc(h.side * 9, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (h.kind === "papaya") {
        [-6, -2, 2, 6].forEach((sy) => {
          ctx.beginPath();
          ctx.arc(h.side * 4, sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      ctx.restore();
    };

    const renderFrame = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      const marketH = Math.round(h * 0.22);

      // 1. Draw Ghanaian Market Header + Wooden Cutting Board
      drawGhanaianMarketHeader(w, marketH);
      drawWoodenCuttingBoard(w, h, marketH);

      // 2. Draw & slowly fade juice splatters on the wooden planks
      for (let i = splattersRef.current.length - 1; i >= 0; i--) {
        const s = splattersRef.current[i];
        s.alpha -= 0.0009;
        if (s.alpha <= 0.02) {
          splattersRef.current.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
        s.blobs.forEach((b) => {
          ctx.beginPath();
          ctx.arc(s.x + b.dx, s.y + b.dy, b.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      // 3. Spawn new fruit waves if active
      const currentStall = STALL_LEVELS[stallIdxRef.current] || STALL_LEVELS[0];
      if (
        !gameOverRef.current &&
        !isPausedForBannerRef.current &&
        now - lastSpawnTimeRef.current >= currentStall.spawnIntervalMs
      ) {
        lastSpawnTimeRef.current = now;
        spawnFruitWave(w, h);
      }

      // 4. Update & draw whole fruits & bombs
      const gravity = 0.26;
      for (let i = fruitsRef.current.length - 1; i >= 0; i--) {
        const f = fruitsRef.current[i];
        if (f.sliced) {
          fruitsRef.current.splice(i, 1);
          continue;
        }
        f.x += f.vx;
        f.y += f.vy;
        f.vy += gravity;
        f.rotation += f.vRot;

        // Keep within side walls
        if (f.x < f.radius + 8) {
          f.x = f.radius + 8;
          f.vx = Math.abs(f.vx) * 0.8;
        } else if (f.x > w - f.radius - 8) {
          f.x = w - f.radius - 8;
          f.vx = -Math.abs(f.vx) * 0.8;
        }

        drawWholeFruitOrBomb(f);

        // Check if fruit dropped below bottom edge unsliced
        if (f.y > h + 52 && f.vy > 0) {
          fruitsRef.current.splice(i, 1);
          if (f.kind !== "bomb" && !gameOverRef.current && !isPausedForBannerRef.current) {
            missesRef.current += 1;
            setMisses(missesRef.current);
            triggerHapticSensor([45, 30, 45]);

            popupsRef.current.push({
              id: nextEntityIdRef.current++,
              x: Math.max(55, Math.min(w - 55, f.x)),
              y: h - 26,
              text: "❌ Missed!",
              color: "#f87171",
              alpha: 1,
              vy: -1.2,
              scale: 1,
            });

            if (missesRef.current >= 3) {
              triggerEndGame("missed");
            }
          }
        }
      }

      // 5. Update & draw sliced fruit halves
      for (let i = halvesRef.current.length - 1; i >= 0; i--) {
        const half = halvesRef.current[i];
        half.x += half.vx;
        half.y += half.vy;
        half.vy += gravity * 1.05;
        half.rotation += half.vRot;
        half.alpha -= 0.016;
        if (half.alpha <= 0 || half.y > h + 60) {
          halvesRef.current.splice(i, 1);
          continue;
        }
        drawSlicedFruitHalf(half);
      }

      // 6. Update & draw juice droplets & confetti particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.isConfetti ? 0.12 : 0.22;
        p.alpha -= p.isConfetti ? 0.012 : 0.024;
        if (p.alpha <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        if (p.isConfetti) {
          ctx.fillRect(p.x, p.y, p.radius * 1.6, p.radius);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 7. Draw glowing silver-white blade swipe trail
      swipeTrailRef.current = swipeTrailRef.current.filter((pt) => now - pt.time < 135);
      const trail = swipeTrailRef.current;
      if (trail.length >= 2) {
        ctx.save();
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          const ratio = i / trail.length;
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + ratio * 0.7})`;
          ctx.shadowColor = "#fef08a";
          ctx.shadowBlur = 10;
          ctx.lineWidth = 2 + ratio * 7;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 8. Draw floating "+10", "COMBO", and "Missed!" popups
      for (let i = popupsRef.current.length - 1; i >= 0; i--) {
        const pop = popupsRef.current[i];
        pop.y += pop.vy;
        pop.alpha -= 0.022;
        if (pop.alpha <= 0) {
          popupsRef.current.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, pop.alpha);
        ctx.font = `900 ${Math.round(18 * pop.scale)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(pop.text, pop.x + 1, pop.y + 2);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x, pop.y);
        ctx.restore();
      }

      // 9. Bomb explosion white/red flash decay
      if (screenFlashAlphaRef.current > 0.01) {
        ctx.save();
        ctx.fillStyle = `rgba(254, 226, 226, ${screenFlashAlphaRef.current})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        screenFlashAlphaRef.current *= 0.86;
      }

      animId = window.requestAnimationFrame(renderFrame);
    };

    animId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animId);
  }, [spawnFruitWave, triggerEndGame]);

  const currentStallConfig = STALL_LEVELS[stallIdx] || STALL_LEVELS[0];

  const handleShareScore = async () => {
    const shareText = `🍉🔪 I just scored ${score} POINTS (Level ${
      stallIdx + 1
    } • ${currentStallConfig.name}) in Market Slash on SwiftData Arena! Slice fruits & win Free Data Bundles: ${
      window.location.origin
    }/challenges`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Market Slash — SwiftData Arena", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2000);
      }
    } catch {
      // ignore cancel
    }
  };

  const screenFit = useDeviceScreenFit();
  const slashFit = screenFit.computeBoardStageMetrics("slash", { reservedTopPx: 38 });

  return (
    <div className="max-w-md mx-auto rounded-[28px] bg-[#1a120b] border-2 border-[#3a2819] shadow-[0_24px_60px_rgba(0,0,0,0.85)] overflow-hidden select-none">
      {/* ── Top Bar: < Games | Market Slash | Device Badge | X pts ── */}
      <div className="px-3 py-2 bg-[#1d140c] border-b border-white/10 flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => (onBackToLobby ? onBackToLobby() : handleRestartGame())}
          className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-200 flex items-center gap-1 transition-all cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Games
        </button>

        <div className="flex items-center gap-1.5">
          <div className="text-sm sm:text-base font-black tracking-tight">
            <span className="text-white">Market </span>
            <span className="text-amber-400">Slash</span>
          </div>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${slashFit.slashCanvasHeightPx}px canvas)`}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[8px] font-mono font-bold text-sky-300"
          >
            📱 {slashFit.fitSummaryLabel}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const next = !vibrationEnabled;
              setVibrationEnabled(next);
              setGameSensoryPreferences({ vibrationEnabled: next });
              if (next) triggerHapticSensor("slice");
            }}
            className={`p-1.5 rounded-full border transition-all ${
              vibrationEnabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 text-slate-500"
            }`}
            title="Toggle Vibration Sensor"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              setGameSensoryPreferences({ soundEnabled: !nextMuted });
            }}
            className="p-1.5 rounded-full border border-white/10 text-amber-300 hover:bg-white/5"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <div className="px-2.5 py-0.5 rounded-full bg-[#2a1d11] border border-amber-500/70 text-amber-400 font-black text-xs font-mono shadow-inner">
            {score} pts
          </div>
        </div>
      </div>

      {/* ── 5-Segment Stall Progress Bar & 3-Strike Miss Counter ── */}
      <div className="px-3.5 py-2 bg-[#22170e] border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex-1 space-y-1">
          <div className="grid grid-cols-5 gap-1.5 max-w-[180px]">
            {STALL_LEVELS.map((s, idx) => {
              const completed = idx < stallIdx;
              const current = idx === stallIdx;
              return (
                <div
                  key={s.level}
                  className={`h-1.5 rounded-full transition-all ${
                    completed
                      ? "bg-amber-400"
                      : current
                      ? "bg-gradient-to-r from-amber-400 to-amber-600 animate-pulse"
                      : "bg-[#3d2d20]"
                  }`}
                />
              );
            })}
          </div>
          <p className="text-[10px] font-bold text-amber-100/80">
            {currentStallConfig.level}/5 · {currentStallConfig.name}
            {mode !== "p2p" && (
              <span className="ml-1.5 text-[9px] text-emerald-300 font-semibold">
                • Beat {effectiveOpponentName} ({aiTargetScore.current} pts)
              </span>
            )}
          </p>
        </div>

        {/* 3 Strike X Indicators */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((strikeIdx) => {
            const missed = strikeIdx < misses;
            return (
              <span
                key={strikeIdx}
                className={`text-sm font-black transition-transform ${
                  missed ? "text-red-500 scale-110" : "text-[#574333]"
                }`}
              >
                ✕
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Main Playfield Canvas Container (Mathematically Fitted to Device Screen Height) ── */}
      <div
        style={{ height: `${slashFit.slashCanvasHeightPx}px` }}
        className="relative w-full bg-[#5c351b] overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          width={420}
          height={560}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-full block touch-none cursor-crosshair"
        />

        {/* Bottom Swipe Hint Pill */}
        {showSwipeHint && !gameOverReason && (
          <div className="pointer-events-none absolute bottom-5 inset-x-0 flex justify-center">
            <div className="px-4 py-1.5 rounded-full bg-black/45 backdrop-blur-sm border border-white/15 text-amber-100/90 text-xs font-bold tracking-wide animate-pulse">
              Swipe fast to slice
            </div>
          </div>
        )}

        {/* Level Intro & STALL CLEARED! Center Overlay */}
        {bannerOverlay && !gameOverReason && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 bg-black/25 backdrop-blur-[1px]">
            <div className="text-center space-y-1 animate-in zoom-in-95 duration-200">
              {bannerOverlay.type === "stall_cleared" ? (
                <>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300 drop-shadow">
                    STALL CLEARED!
                  </p>
                  <p className="text-5xl font-black text-amber-400 drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)]">
                    +{bannerOverlay.bonus}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-400 drop-shadow">
                    LEVEL {bannerOverlay.level}
                  </p>
                  <h3 className="text-3xl font-black text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]">
                    {bannerOverlay.title}
                  </h3>
                  <p className="text-xs font-semibold text-amber-100/90 drop-shadow">
                    {bannerOverlay.subtitle}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── White Game-Over / Victory Summary Card (Matches 00:46 of Video) ── */}
        {gameOverReason && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-5 animate-in fade-in duration-200">
            <div className="w-full max-w-[330px] rounded-[28px] bg-[#faf7f2] text-slate-900 p-6 shadow-2xl text-center space-y-4 border border-amber-200">
              <div className="space-y-1">
                <p
                  className={`text-xs font-black uppercase tracking-widest ${
                    gameOverReason === "cleared_all" ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {gameOverReason === "bomb"
                    ? "YOU CUT A BOMB."
                    : gameOverReason === "missed"
                    ? "3 FRUITS MISSED."
                    : "ALL 5 MARKET STALLS CLEARED!"}
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  You reached level {stallIdx + 1} ({currentStallConfig.name})
                </p>
              </div>

              <div>
                <p className="text-5xl font-black text-slate-900 tracking-tight leading-none">
                  {score}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mt-1">
                  POINTS
                </p>
              </div>

              {/* 3 Stat Boxes: sliced | best combo | best */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-2xl bg-[#efeae1]">
                  <p className="text-base font-black text-slate-900">{totalSliced}</p>
                  <p className="text-[10px] font-semibold text-slate-500">sliced</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-[#efeae1]">
                  <p className="text-base font-black text-slate-900">{bestCombo}x</p>
                  <p className="text-[10px] font-semibold text-slate-500">best combo</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-[#efeae1]">
                  <p className="text-base font-black text-slate-900">
                    {Math.max(bestScore, score)}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-500">best</p>
                </div>
              </div>

              {/* Challenger Comparison Pill */}
              {mode !== "p2p" && (
                <div
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 ${
                    score >= aiTargetScore.current
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  {score >= aiTargetScore.current
                    ? `You beat ${effectiveOpponentName} (${aiTargetScore.current} pts)!`
                    : `${effectiveOpponentName} scored ${aiTargetScore.current} pts — try again!`}
                </div>
              )}

              {/* Share & Play Again Buttons */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleShareScore}
                  className="h-11 rounded-full bg-[#efeae1] hover:bg-[#e5dfd3] text-slate-800 font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {copiedShare ? "Copied!" : "Share"}
                </button>
                <button
                  type="button"
                  onClick={handleRestartGame}
                  className="h-11 rounded-full bg-[#f59e0b] hover:bg-[#d97706] text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Play again
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-snug pt-1">
                Tip: short, quick swipes. Watch for bombs behind the fruit.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

