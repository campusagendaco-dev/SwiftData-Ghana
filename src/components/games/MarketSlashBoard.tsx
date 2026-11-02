import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Smartphone,
  ChevronLeft,
  Share2,
  RotateCcw,
  Trophy,
  Flame,
  Sparkles,
} from "lucide-react";
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
  waveIntervalBase: number;
  bombProbability: number;
  maxWaveSize: number;
}

const STALL_LEVELS: StallLevelConfig[] = [
  {
    level: 1,
    name: "Morning Dojo Stall",
    subtitle: "Swipe to slice. Don't touch the bombs!",
    fruitsToClear: 12,
    clearBonus: 15,
    waveIntervalBase: 1.35,
    bombProbability: 0.1,
    maxWaveSize: 3,
  },
  {
    level: 2,
    name: "Busy Citrus Stand",
    subtitle: "Faster tosses — chain 3+ fruits in one swipe!",
    fruitsToClear: 16,
    clearBonus: 25,
    waveIntervalBase: 1.18,
    bombProbability: 0.14,
    maxWaveSize: 4,
  },
  {
    level: 3,
    name: "Rush Hour Blade",
    subtitle: "Watch for bombs hiding in fruit clusters",
    fruitsToClear: 20,
    clearBonus: 35,
    waveIntervalBase: 1.02,
    bombProbability: 0.18,
    maxWaveSize: 4,
  },
  {
    level: 4,
    name: "Kejetia Master",
    subtitle: "High-velocity multi-fruit volleys incoming!",
    fruitsToClear: 24,
    clearBonus: 50,
    waveIntervalBase: 0.9,
    bombProbability: 0.21,
    maxWaveSize: 5,
  },
  {
    level: 5,
    name: "Grand Fruit Slash Finale",
    subtitle: "Ultimate Grandmaster Blade Stage!",
    fruitsToClear: 28,
    clearBonus: 75,
    waveIntervalBase: 0.8,
    bombProbability: 0.24,
    maxWaveSize: 5,
  },
];

interface FruitTypeSpec {
  name: "watermelon" | "orange" | "apple" | "kiwi" | "lemon" | "papaya" | "pineapple";
  skinLight: string;
  skinDark: string;
  fleshInner: string;
  fleshOuter: string;
  juiceColor: string;
  radiusScale: number;
  pattern: "watermelon" | "citrus" | "apple" | "kiwi" | "papaya" | "pineapple";
  points: number;
}

const FRUIT_TYPES: FruitTypeSpec[] = [
  {
    name: "watermelon",
    skinLight: "#59c24a",
    skinDark: "#1d6b2a",
    fleshInner: "#ff6b7a",
    fleshOuter: "#e8283f",
    juiceColor: "#ff4d63",
    radiusScale: 1.22,
    pattern: "watermelon",
    points: 10,
  },
  {
    name: "orange",
    skinLight: "#ffb347",
    skinDark: "#e8710a",
    fleshInner: "#ffc36b",
    fleshOuter: "#ff9a1f",
    juiceColor: "#ffa62b",
    radiusScale: 1.0,
    pattern: "citrus",
    points: 10,
  },
  {
    name: "apple",
    skinLight: "#ff5a5a",
    skinDark: "#a8101d",
    fleshInner: "#fffbe6",
    fleshOuter: "#f6edc0",
    juiceColor: "#fff4c2",
    radiusScale: 0.96,
    pattern: "apple",
    points: 10,
  },
  {
    name: "kiwi",
    skinLight: "#b08a5a",
    skinDark: "#6b4a26",
    fleshInner: "#c8ef6a",
    fleshOuter: "#6fbf2a",
    juiceColor: "#9be03a",
    radiusScale: 0.9,
    pattern: "kiwi",
    points: 12,
  },
  {
    name: "lemon",
    skinLight: "#fff27a",
    skinDark: "#e8c20c",
    fleshInner: "#fffbc2",
    fleshOuter: "#f7e04a",
    juiceColor: "#fff06a",
    radiusScale: 0.92,
    pattern: "citrus",
    points: 10,
  },
  {
    name: "papaya",
    skinLight: "#fde047",
    skinDark: "#ea580c",
    fleshInner: "#fdba74",
    fleshOuter: "#f97316",
    juiceColor: "#fb923c",
    radiusScale: 1.06,
    pattern: "papaya",
    points: 12,
  },
  {
    name: "pineapple",
    skinLight: "#facc15",
    skinDark: "#b45309",
    fleshInner: "#fef08a",
    fleshOuter: "#eab308",
    juiceColor: "#fde047",
    radiusScale: 1.12,
    pattern: "pineapple",
    points: 15,
  },
];

const GRAVITY_SCREEN_HEIGHTS_PER_SECOND_SQUARED = 1.15;
const MAXIMUM_LIVES = 3;
const TRAIL_LIFETIME_SECONDS = 0.22;
const MINIMUM_SLICE_SEGMENT_LENGTH = 5;
const BEST_SCORE_STORAGE_KEY = "swiftdata_market_slash_best";

interface FlyingProjectile {
  id: number;
  isBomb: boolean;
  fruitType: FruitTypeSpec;
  radius: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  spinSpeed: number;
  sliced?: boolean;
}

interface FruitHalf {
  fruitType: FruitTypeSpec;
  radius: number;
  side: -1 | 1;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  spinSpeed: number;
}

interface JuiceParticle {
  x: number;
  y: number;
  color: string;
  velocityX: number;
  velocityY: number;
  radius: number;
  lifetimeSeconds: number;
  lifeRemainingSeconds: number;
  isConfetti?: boolean;
}

interface JuiceSplat {
  x: number;
  y: number;
  color: string;
  radius: number;
  droplets: { offsetX: number; offsetY: number; radius: number }[];
  ageSeconds: number;
  lifetimeSeconds: number;
}

interface FloatingText {
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  ageSeconds: number;
  lifetimeSeconds: number;
}

interface TrailPoint {
  x: number;
  y: number;
  bornAtSeconds: number;
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

const randomBetween = (minimum: number, maximum: number) =>
  minimum + Math.random() * (maximum - minimum);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

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

  // Target score calibrated for upgraded Fruit Slash scoring
  const aiTargetScore = useRef<number>(
    Math.round(420 + Math.min(5, playerLevel) * 55 + (Math.random() * 70 - 35))
  );

  const [score, setScore] = useState<number>(0);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const [stallIdx, setStallIdx] = useState<number>(0);
  const [remainingLives, setRemainingLives] = useState<number>(MAXIMUM_LIVES);
  const [totalSliced, setTotalSliced] = useState<number>(0);
  const [bestCombo, setBestCombo] = useState<number>(1);
  const [timeRemainingSec, setTimeRemainingSec] = useState<number>(60);
  const [gameOverReason, setGameOverReason] = useState<
    "bomb" | "missed" | "timeout" | "cleared_all" | null
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

  // Canvas & Simulation Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backgroundLayerRef = useRef<HTMLCanvasElement | null>(null);
  const viewportSizeRef = useRef<{ width: number; height: number; baseFruitRadius: number }>({
    width: 420,
    height: 560,
    baseFruitRadius: 34,
  });

  const flyingProjectilesRef = useRef<FlyingProjectile[]>([]);
  const fruitHalvesRef = useRef<FruitHalf[]>([]);
  const juiceParticlesRef = useRef<JuiceParticle[]>([]);
  const juiceSplatsRef = useRef<JuiceSplat[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const trailPointsRef = useRef<TrailPoint[]>([]);
  const pendingTimersRef = useRef<number[]>([]);
  const nextEntityIdRef = useRef<number>(1);

  // Slashing & Combo State Refs
  const isSlashingRef = useRef<boolean>(false);
  const lastPointerPositionRef = useRef<TrailPoint | null>(null);
  const swipeSliceCountRef = useRef<number>(0);
  const lastSlicePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const recentSliceTimesRef = useRef<number[]>([]);

  // Game Loop Physics & Progression Refs
  const scoreRef = useRef<number>(0);
  const bestScoreRef = useRef<number>(bestScore);
  const stallIdxRef = useRef<number>(0);
  const stallSlicedCountRef = useRef<number>(0);
  const totalSlicedRef = useRef<number>(0);
  const bestComboRef = useRef<number>(1);
  const remainingLivesRef = useRef<number>(MAXIMUM_LIVES);
  const elapsedPlaySecondsRef = useRef<number>(0);
  const secondsUntilNextWaveRef = useRef<number>(0.65);
  const slowMotionFactorRef = useRef<number>(1);
  const screenShakeStrengthRef = useRef<number>(0);
  const whiteFlashAlphaRef = useRef<number>(0);
  const gameOverRef = useRef<"bomb" | "missed" | "timeout" | "cleared_all" | null>(null);
  const isPausedForBannerRef = useRef<boolean>(true);
  const matchSettledRef = useRef<boolean>(false);
  const mutedRef = useRef<boolean>(muted);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Built-in Web Audio Procedural Sound Synthesizer (from Fruit Slash Engine)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);

  const ensureAudioReady = useCallback(() => {
    if (mutedRef.current) return;
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < channel.length; i++) {
          channel[i] = Math.random() * 2 - 1;
        }
        audioCtxRef.current = ctx;
        noiseBufferRef.current = buffer;
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {
      // Ignore Web Audio restriction errors
    }
  }, []);

  const playNoiseBurst = useCallback(
    ({
      duration,
      filterType,
      filterFrequency,
      volume,
    }: {
      duration: number;
      filterType: BiquadFilterType;
      filterFrequency: number;
      volume: number;
    }) => {
      if (mutedRef.current || !audioCtxRef.current || !noiseBufferRef.current) return;
      try {
        const ctx = audioCtxRef.current;
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        source.buffer = noiseBufferRef.current;
        filter.type = filterType;
        filter.frequency.value = filterFrequency;
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start();
        source.stop(ctx.currentTime + duration);
      } catch {
        // ignore
      }
    },
    []
  );

  const playTone = useCallback(
    ({
      startFrequency,
      endFrequency,
      duration,
      waveType,
      volume,
    }: {
      startFrequency: number;
      endFrequency: number;
      duration: number;
      waveType: OscillatorType;
      volume: number;
    }) => {
      if (mutedRef.current || !audioCtxRef.current) return;
      try {
        const ctx = audioCtxRef.current;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = waveType;
        oscillator.frequency.setValueAtTime(startFrequency, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + duration);
      } catch {
        // ignore
      }
    },
    []
  );

  const soundEffects = useRef({
    slice: (comboCount = 1) => {
      playNoiseBurst({
        duration: 0.14,
        filterType: "highpass",
        filterFrequency: 3200,
        volume: 0.35,
      });
      playTone({
        startFrequency: 520 + Math.min(comboCount, 6) * 45,
        endFrequency: 140,
        duration: 0.12,
        waveType: "triangle",
        volume: 0.18,
      });
      playFruitSliceSound(comboCount);
    },
    bomb: () => {
      playNoiseBurst({
        duration: 0.6,
        filterType: "lowpass",
        filterFrequency: 900,
        volume: 0.9,
      });
      playTone({
        startFrequency: 150,
        endFrequency: 30,
        duration: 0.55,
        waveType: "sawtooth",
        volume: 0.5,
      });
      playBombExplosionSound();
    },
    miss: () => {
      playTone({
        startFrequency: 330,
        endFrequency: 110,
        duration: 0.3,
        waveType: "square",
        volume: 0.12,
      });
    },
    combo: () => {
      playTone({
        startFrequency: 660,
        endFrequency: 990,
        duration: 0.18,
        waveType: "sine",
        volume: 0.25,
      });
      window.setTimeout(
        () =>
          playTone({
            startFrequency: 990,
            endFrequency: 1480,
            duration: 0.25,
            waveType: "sine",
            volume: 0.25,
          }),
        90
      );
    },
  });

  // Load Google Font 'Lilita One' for authentic Fruit Slash arcade typography
  useEffect(() => {
    const id = "fruit-slash-lilita-font";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Lilita+One&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // Dismiss initial Level 1 intro banner after 1.2s
  useEffect(() => {
    const t = window.setTimeout(() => {
      setBannerOverlay(null);
      isPausedForBannerRef.current = false;
      secondsUntilNextWaveRef.current = 0.35;
    }, 1200);
    return () => window.clearTimeout(t);
  }, []);

  const clearPendingWaveTimers = useCallback(() => {
    pendingTimersRef.current.forEach((id) => window.clearTimeout(id));
    pendingTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearPendingWaveTimers();
  }, [clearPendingWaveTimers]);

  const triggerEndGame = useCallback(
    (reason: "bomb" | "missed" | "timeout" | "cleared_all") => {
      if (gameOverRef.current) return;
      gameOverRef.current = reason;
      clearPendingWaveTimers();

      const finalPts = scoreRef.current;
      const isNewBest = finalPts > bestScoreRef.current;
      if (isNewBest) {
        bestScoreRef.current = finalPts;
        setBestScore(finalPts);
        try {
          window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(finalPts));
        } catch {
          // ignore
        }
      }

      // Delay overlay slightly on bomb explosion so player enjoys the slow-mo & shake
      const delayMs = reason === "bomb" ? 750 : 250;
      window.setTimeout(() => {
        setGameOverReason(reason);
      }, delayMs);

      if (!matchSettledRef.current) {
        matchSettledRef.current = true;
        const oppScore =
          mode === "p2p"
            ? initialState?.opponentScore || 0
            : aiTargetScore.current;
        const winnerSide: "creator" | "opponent" | "draw" =
          reason === "timeout" && finalPts < oppScore
            ? mySide === "creator"
              ? "opponent"
              : "creator"
            : finalPts > oppScore
            ? mySide
            : finalPts < oppScore
            ? mySide === "creator"
              ? "opponent"
              : "creator"
            : "draw";

        if (winnerSide === mySide && reason !== "bomb") {
          playLevelUpFanfare();
          onPointsEarned?.(35, `Fruit Slash Timed Victory (${finalPts} pts)`);
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
    [clearPendingWaveTimers, initialState, mode, mySide, onMatchComplete, onPointsEarned, onStateChange]
  );

  const handleRestartGame = useCallback(() => {
    ensureAudioReady();
    clearPendingWaveTimers();
    flyingProjectilesRef.current = [];
    fruitHalvesRef.current = [];
    juiceParticlesRef.current = [];
    juiceSplatsRef.current = [];
    floatingTextsRef.current = [];
    trailPointsRef.current = [];

    scoreRef.current = 0;
    stallIdxRef.current = 0;
    stallSlicedCountRef.current = 0;
    totalSlicedRef.current = 0;
    bestComboRef.current = 1;
    remainingLivesRef.current = MAXIMUM_LIVES;
    elapsedPlaySecondsRef.current = 0;
    secondsUntilNextWaveRef.current = 0.4;
    slowMotionFactorRef.current = 1;
    screenShakeStrengthRef.current = 0;
    whiteFlashAlphaRef.current = 0;
    gameOverRef.current = null;

    setScore(0);
    setStallIdx(0);
    setRemainingLives(MAXIMUM_LIVES);
    setTotalSliced(0);
    setBestCombo(1);
    setTimeRemainingSec(60);
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
      secondsUntilNextWaveRef.current = 0.35;
    }, 1050);
  }, [clearPendingWaveTimers, ensureAudioReady]);

  const addFloatingText = useCallback(
    (text: string, x: number, y: number, color: string, fontSize: number) => {
      floatingTextsRef.current.push({
        text,
        x,
        y,
        color,
        fontSize,
        ageSeconds: 0,
        lifetimeSeconds: 0.9,
      });
    },
    []
  );

  const spawnJuice = useCallback(
    (
      x: number,
      y: number,
      color: string,
      particleCount: number,
      speedMultiplier: number,
      isConfetti = false
    ) => {
      for (let i = 0; i < particleCount; i++) {
        const burstAngle = randomBetween(0, Math.PI * 2);
        const burstSpeed = randomBetween(85, 390) * speedMultiplier;
        const lifetimeSeconds = randomBetween(0.5, 1.15);
        juiceParticlesRef.current.push({
          x,
          y,
          color,
          velocityX: Math.cos(burstAngle) * burstSpeed,
          velocityY: Math.sin(burstAngle) * burstSpeed - 120,
          radius: isConfetti ? randomBetween(3.5, 6.5) : randomBetween(2.2, 5.8),
          lifetimeSeconds,
          lifeRemainingSeconds: lifetimeSeconds,
          isConfetti,
        });
      }
    },
    []
  );

  const launchProjectile = useCallback((isBomb: boolean) => {
    if (gameOverRef.current || isPausedForBannerRef.current) return;
    const { width: viewportWidth, height: viewportHeight, baseFruitRadius } =
      viewportSizeRef.current;

    const fruitType = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    const radius = isBomb
      ? baseFruitRadius * 0.95
      : baseFruitRadius * fruitType.radiusScale;
    const startX = randomBetween(viewportWidth * 0.12, viewportWidth * 0.88);
    const gravityPixelsPerSecondSquared =
      viewportHeight * GRAVITY_SCREEN_HEIGHTS_PER_SECOND_SQUARED;
    const peakY = viewportHeight * randomBetween(0.16, 0.44);
    const launchSpeedY = -Math.sqrt(
      2 * gravityPixelsPerSecondSquared * (viewportHeight + radius - peakY)
    );
    const flightDurationSeconds =
      (2 * Math.abs(launchSpeedY)) / gravityPixelsPerSecondSquared;
    const landingX = randomBetween(viewportWidth * 0.18, viewportWidth * 0.82);

    flyingProjectilesRef.current.push({
      id: nextEntityIdRef.current++,
      isBomb,
      fruitType,
      radius,
      x: startX,
      y: viewportHeight + radius,
      velocityX: (landingX - startX) / flightDurationSeconds,
      velocityY: launchSpeedY,
      rotation: randomBetween(0, Math.PI * 2),
      spinSpeed: randomBetween(-4.2, 4.2),
    });
  }, []);

  const spawnWave = useCallback(() => {
    if (gameOverRef.current || isPausedForBannerRef.current) return;
    const config = STALL_LEVELS[stallIdxRef.current] || STALL_LEVELS[0];
    const dynamicMax = Math.min(
      config.maxWaveSize,
      1 + Math.floor(Math.random() * (1.6 + elapsedPlaySecondsRef.current / 16))
    );
    const waveSize = Math.max(1, dynamicMax);
    const bombChance = Math.min(
      config.bombProbability + elapsedPlaySecondsRef.current * 0.0015,
      0.26
    );

    let bombsInThisWave = 0;
    for (let waveIndex = 0; waveIndex < waveSize; waveIndex++) {
      const timerId = window.setTimeout(() => {
        const canSpawnBomb = waveSize >= 2 && bombsInThisWave < 1;
        const isBomb = canSpawnBomb && Math.random() < bombChance;
        if (isBomb) bombsInThisWave++;
        launchProjectile(isBomb);
      }, waveIndex * 110);
      pendingTimersRef.current.push(timerId);
    }

    const waveIntervalSeconds = Math.max(
      0.58,
      config.waveIntervalBase - elapsedPlaySecondsRef.current * 0.008
    );
    secondsUntilNextWaveRef.current = waveIntervalSeconds;
  }, [launchProjectile]);

  const explodeBomb = useCallback(
    (projectile: FlyingProjectile) => {
      spawnJuice(projectile.x, projectile.y, "#ffb02e", 45, 1.6);
      spawnJuice(projectile.x, projectile.y, "#ffffff", 25, 1.9);
      soundEffects.current.bomb();
      triggerHapticSensor("bomb");
      screenShakeStrengthRef.current = 22;
      whiteFlashAlphaRef.current = 0.85;
      slowMotionFactorRef.current = 0.25;
      triggerEndGame("bomb");
    },
    [spawnJuice, triggerEndGame]
  );

  const sliceFruit = useCallback(
    (projectile: FlyingProjectile, sliceAngle: number) => {
      if (projectile.sliced || gameOverRef.current) return;
      projectile.sliced = true;

      const { width: viewportWidth, height: viewportHeight } = viewportSizeRef.current;

      // Split into two directional halves along perpendicular of sliceAngle
      const perpendicularAngle = sliceAngle + Math.PI / 2;
      for (const side of [-1, 1] as const) {
        const separationSpeed = randomBetween(115, 205);
        fruitHalvesRef.current.push({
          fruitType: projectile.fruitType,
          radius: projectile.radius,
          side,
          x: projectile.x,
          y: projectile.y,
          velocityX:
            projectile.velocityX * 0.5 +
            Math.cos(perpendicularAngle) * side * separationSpeed,
          velocityY:
            projectile.velocityY * 0.4 +
            Math.sin(perpendicularAngle) * side * separationSpeed -
            65,
          rotation: sliceAngle,
          spinSpeed: side * randomBetween(1.6, 4.6),
        });
      }

      // Burst of directional juice droplets + persistent board splat
      spawnJuice(projectile.x, projectile.y, projectile.fruitType.juiceColor, 24, 1);
      juiceSplatsRef.current.push({
        x: projectile.x,
        y: projectile.y,
        color: projectile.fruitType.juiceColor,
        radius: projectile.radius * randomBetween(0.9, 1.3),
        droplets: Array.from({ length: 6 }, () => ({
          offsetX: randomBetween(-1.6, 1.6) * projectile.radius,
          offsetY: randomBetween(-1.6, 1.6) * projectile.radius,
          radius: randomBetween(3, 11),
        })),
        ageSeconds: 0,
        lifetimeSeconds: 4.5,
      });
      if (juiceSplatsRef.current.length > 18) {
        juiceSplatsRef.current.shift();
      }

      // Compute rapid slice window combo
      const now = performance.now();
      recentSliceTimesRef.current = [
        ...recentSliceTimesRef.current.filter((t) => now - t < 340),
        now,
      ];
      const rapidCombo = recentSliceTimesRef.current.length;
      if (rapidCombo > bestComboRef.current) {
        bestComboRef.current = rapidCombo;
        setBestCombo(rapidCombo);
      }

      soundEffects.current.slice(rapidCombo);
      triggerHapticSensor("slice");
      screenShakeStrengthRef.current = Math.max(
        screenShakeStrengthRef.current,
        rapidCombo >= 3 ? 4.5 : 2.5
      );

      const basePts = projectile.fruitType.points;
      const ptsAdded = rapidCombo >= 3 ? basePts + 10 : rapidCombo === 2 ? basePts + 5 : basePts;
      scoreRef.current += ptsAdded;
      setScore(scoreRef.current);

      totalSlicedRef.current += 1;
      setTotalSliced(totalSlicedRef.current);

      if (totalSlicedRef.current % 25 === 0) {
        onPointsEarned?.(5, "25 Fruits Sliced (+5 Arena Pts)");
      }

      addFloatingText(
        rapidCombo >= 2 ? `+${ptsAdded} (${rapidCombo}x)` : `+${ptsAdded}`,
        projectile.x,
        projectile.y - projectile.radius * 0.85,
        rapidCombo >= 2 ? "#ffc93c" : "#fff1b8",
        rapidCombo >= 2 ? 36 : 30
      );

      // Check Stall Level Completion
      stallSlicedCountRef.current += 1;
      const currentStall = STALL_LEVELS[stallIdxRef.current];
      if (
        currentStall &&
        stallSlicedCountRef.current >= currentStall.fruitsToClear &&
        !isPausedForBannerRef.current
      ) {
        isPausedForBannerRef.current = true;
        clearPendingWaveTimers();
        flyingProjectilesRef.current = [];

        const bonus = currentStall.clearBonus;
        scoreRef.current += bonus;
        setScore(scoreRef.current);

        playStallClearedSound();
        const confettiColors = ["#ffc93c", "#ff4d63", "#59c24a", "#38bdf8", "#a855f7"];
        confettiColors.forEach((c) =>
          spawnJuice(viewportWidth / 2, viewportHeight * 0.45, c, 10, 1.35, true)
        );
        onPointsEarned?.(60, `Stage ${currentStall.level} Cleared (+60 Arena Pts)`);

        setBannerOverlay({
          type: "stall_cleared",
          level: currentStall.level,
          title: "STAGE CLEARED!",
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
            secondsUntilNextWaveRef.current = 0.4;
          }, 1250);
        }, 1350);
      }
    },
    [addFloatingText, clearPendingWaveTimers, onPointsEarned, spawnJuice, triggerEndGame]
  );

  const finalizeSwipeCombo = useCallback(() => {
    const count = swipeSliceCountRef.current;
    if (!gameOverRef.current && count >= 3) {
      const comboBonus = count * 10;
      scoreRef.current += comboBonus;
      setScore(scoreRef.current);
      if (count > bestComboRef.current) {
        bestComboRef.current = count;
        setBestCombo(count);
      }
      addFloatingText(
        `COMBO x${count} +${comboBonus}`,
        lastSlicePositionRef.current.x,
        lastSlicePositionRef.current.y - 48,
        "#ffc93c",
        42
      );
      soundEffects.current.combo();
      slowMotionFactorRef.current = 0.65;
    }
    swipeSliceCountRef.current = 0;
  }, [addFloatingText]);

  const distanceFromPointToSegment = (
    pointX: number,
    pointY: number,
    segmentStart: { x: number; y: number },
    segmentEnd: { x: number; y: number }
  ) => {
    const segmentVectorX = segmentEnd.x - segmentStart.x;
    const segmentVectorY = segmentEnd.y - segmentStart.y;
    const segmentLengthSquared = segmentVectorX ** 2 + segmentVectorY ** 2;
    const projection =
      segmentLengthSquared === 0
        ? 0
        : clamp(
            ((pointX - segmentStart.x) * segmentVectorX +
              (pointY - segmentStart.y) * segmentVectorY) /
              segmentLengthSquared,
            0,
            1
          );
    return Math.hypot(
      pointX - (segmentStart.x + projection * segmentVectorX),
      pointY - (segmentStart.y + projection * segmentVectorY)
    );
  };

  const sliceAlongSegment = useCallback(
    (segmentStart: TrailPoint, segmentEnd: TrailPoint) => {
      if (gameOverRef.current || isPausedForBannerRef.current) return;
      if (
        Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y) <
        MINIMUM_SLICE_SEGMENT_LENGTH
      ) {
        return;
      }
      const sliceAngle = Math.atan2(
        segmentEnd.y - segmentStart.y,
        segmentEnd.x - segmentStart.x
      );

      flyingProjectilesRef.current = flyingProjectilesRef.current.filter((projectile) => {
        if (
          distanceFromPointToSegment(
            projectile.x,
            projectile.y,
            segmentStart,
            segmentEnd
          ) >
          projectile.radius + 6
        ) {
          return true;
        }
        if (projectile.isBomb) {
          explodeBomb(projectile);
        } else {
          sliceFruit(projectile, sliceAngle);
          swipeSliceCountRef.current += 1;
          lastSlicePositionRef.current = { x: projectile.x, y: projectile.y };
        }
        return false;
      });
    },
    [explodeBomb, sliceFruit]
  );

  // Build cached offscreen wood dojo + rising sun + Ghanaian market accent background
  const buildBackgroundLayer = useCallback(
    (viewportWidth: number, viewportHeight: number, pixelRatio: number) => {
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = viewportWidth * pixelRatio;
      bgCanvas.height = viewportHeight * pixelRatio;
      const layerContext = bgCanvas.getContext("2d");
      if (!layerContext) return;
      layerContext.scale(pixelRatio, pixelRatio);

      // 1. Rich dark mahogany wood base gradient
      const woodGradient = layerContext.createLinearGradient(0, 0, 0, viewportHeight);
      woodGradient.addColorStop(0, "#4a2815");
      woodGradient.addColorStop(1, "#170b06");
      layerContext.fillStyle = woodGradient;
      layerContext.fillRect(0, 0, viewportWidth, viewportHeight);

      // 2. Vertical wood planks + dark seams + warm grain fibers
      const plankWidth = Math.max(54, viewportWidth / 8);
      for (let plankX = 0; plankX < viewportWidth; plankX += plankWidth) {
        layerContext.fillStyle = `rgba(0, 0, 0, ${randomBetween(0.04, 0.16)})`;
        layerContext.fillRect(plankX, 0, plankWidth, viewportHeight);
        layerContext.fillStyle = "rgba(0, 0, 0, 0.38)";
        layerContext.fillRect(plankX, 0, 2, viewportHeight);
        for (let grainIndex = 0; grainIndex < 7; grainIndex++) {
          layerContext.fillStyle = `rgba(255, 190, 120, ${randomBetween(0.015, 0.045)})`;
          layerContext.fillRect(
            plankX + randomBetween(5, plankWidth - 5),
            0,
            1.5,
            viewportHeight
          );
        }
      }

      // 3. Top colorful Ghanaian market awning trim (subtle festive market vibe)
      const stripeCount = 12;
      const stripeW = viewportWidth / stripeCount;
      const awningColors = ["#ef4444", "#facc15", "#22c55e", "#f97316"];
      for (let i = 0; i < stripeCount; i++) {
        layerContext.fillStyle = awningColors[i % awningColors.length];
        layerContext.globalAlpha = 0.22;
        layerContext.beginPath();
        layerContext.roundRect(i * stripeW, -6, stripeW + 1, 14, 5);
        layerContext.fill();
      }
      layerContext.globalAlpha = 1;

      // 4. Warm Dojo Rising Sun center glow
      const risingSunRadius = Math.min(viewportWidth, viewportHeight) * 0.44;
      const sunGradient = layerContext.createRadialGradient(
        viewportWidth / 2,
        viewportHeight * 0.52,
        risingSunRadius * 0.18,
        viewportWidth / 2,
        viewportHeight * 0.52,
        risingSunRadius
      );
      sunGradient.addColorStop(0, "rgba(255, 90, 40, 0.22)");
      sunGradient.addColorStop(1, "rgba(255, 90, 40, 0)");
      layerContext.fillStyle = sunGradient;
      layerContext.fillRect(0, 0, viewportWidth, viewportHeight);

      // 5. Deep cinematic vignette
      const vignetteGradient = layerContext.createRadialGradient(
        viewportWidth / 2,
        viewportHeight / 2,
        Math.min(viewportWidth, viewportHeight) * 0.28,
        viewportWidth / 2,
        viewportHeight / 2,
        Math.hypot(viewportWidth, viewportHeight) * 0.62
      );
      vignetteGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignetteGradient.addColorStop(1, "rgba(0, 0, 0, 0.72)");
      layerContext.fillStyle = vignetteGradient;
      layerContext.fillRect(0, 0, viewportWidth, viewportHeight);

      backgroundLayerRef.current = bgCanvas;
    },
    []
  );

  // Pointer input handlers
  const getCanvasLogicalPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): TrailPoint => {
    const canvas = canvasRef.current;
    const nowSeconds = performance.now() / 1000;
    if (!canvas) return { x: 0, y: 0, bornAtSeconds: nowSeconds };
    const rect = canvas.getBoundingClientRect();
    const { width, height } = viewportSizeRef.current;
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * width,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * height,
      bornAtSeconds: nowSeconds,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ensureAudioReady();
    if (gameOverRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isSlashingRef.current = true;
    swipeSliceCountRef.current = 0;
    if (showSwipeHint) setShowSwipeHint(false);

    const pt = getCanvasLogicalPoint(e);
    trailPointsRef.current.push(pt);
    lastPointerPositionRef.current = pt;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isSlashingRef.current || gameOverRef.current) return;
    const currentPoint = getCanvasLogicalPoint(e);
    trailPointsRef.current.push(currentPoint);
    if (lastPointerPositionRef.current) {
      sliceAlongSegment(lastPointerPositionRef.current, currentPoint);
    }
    lastPointerPositionRef.current = currentPoint;
  };

  const handlePointerUpOrCancel = () => {
    if (!isSlashingRef.current) return;
    isSlashingRef.current = false;
    finalizeSwipeCombo();
  };

  // Main High-DPI Canvas Render & Delta-Time Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const syncCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewportWidth = Math.max(320, Math.round(rect.width || 420));
      const viewportHeight = Math.max(380, Math.round(rect.height || 560));
      canvas.width = viewportWidth * pixelRatio;
      canvas.height = viewportHeight * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const baseFruitRadius = clamp(
        Math.min(viewportWidth, viewportHeight) * 0.082,
        28,
        46
      );
      viewportSizeRef.current = {
        width: viewportWidth,
        height: viewportHeight,
        baseFruitRadius,
      };
      buildBackgroundLayer(viewportWidth, viewportHeight, pixelRatio);
    };

    syncCanvasDimensions();
    window.addEventListener("resize", syncCanvasDimensions);

    const drawFruitBody = (fruitType: FruitTypeSpec, radius: number) => {
      // Soft drop shadow
      context.fillStyle = "rgba(0, 0, 0, 0.32)";
      context.beginPath();
      context.arc(4, 6, radius * 0.98, 0, Math.PI * 2);
      context.fill();

      // Pineapple crown leaves before body
      if (fruitType.pattern === "pineapple") {
        context.fillStyle = "#16a34a";
        [-0.45, -0.22, 0, 0.22, 0.45].forEach((ang, idx) => {
          context.save();
          context.translate(0, -radius * 0.8);
          context.rotate(ang);
          context.beginPath();
          context.moveTo(-radius * 0.16, 0);
          context.lineTo(0, -radius * (0.48 + (idx % 2) * 0.14));
          context.lineTo(radius * 0.16, 0);
          context.closePath();
          context.fill();
          context.restore();
        });
      }

      const skinGradient = context.createRadialGradient(
        -radius * 0.3,
        -radius * 0.35,
        radius * 0.1,
        0,
        0,
        radius
      );
      skinGradient.addColorStop(0, fruitType.skinLight);
      skinGradient.addColorStop(1, fruitType.skinDark);
      context.fillStyle = skinGradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.clip();
      if (fruitType.pattern === "watermelon") {
        context.strokeStyle = "rgba(8, 50, 16, 0.55)";
        context.lineWidth = radius * 0.1;
        for (const stripeWidthRatio of [0.3, 0.62, 0.92]) {
          context.beginPath();
          context.ellipse(0, 0, radius * stripeWidthRatio, radius, 0, 0, Math.PI * 2);
          context.stroke();
        }
      } else if (fruitType.pattern === "citrus" || fruitType.pattern === "kiwi") {
        context.fillStyle = "rgba(0, 0, 0, 0.13)";
        for (let poreIndex = 0; poreIndex < 22; poreIndex++) {
          const poreAngle = poreIndex * 2.4;
          const poreDistance = radius * (((poreIndex % 5) / 5) * 0.8 + 0.1);
          context.beginPath();
          context.arc(
            Math.cos(poreAngle) * poreDistance,
            Math.sin(poreAngle) * poreDistance,
            radius * 0.025,
            0,
            Math.PI * 2
          );
          context.fill();
        }
      } else if (fruitType.pattern === "pineapple") {
        context.strokeStyle = "rgba(120, 53, 15, 0.5)";
        context.lineWidth = radius * 0.045;
        for (let d = -radius; d <= radius; d += radius * 0.38) {
          context.beginPath();
          context.moveTo(d - radius * 0.5, -radius);
          context.lineTo(d + radius * 0.5, radius);
          context.moveTo(d + radius * 0.5, -radius);
          context.lineTo(d - radius * 0.5, radius);
          context.stroke();
        }
      }
      context.restore();

      if (fruitType.pattern === "apple" || fruitType.pattern === "papaya") {
        context.strokeStyle = "#4a2c14";
        context.lineWidth = radius * 0.09;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(0, -radius * 0.75);
        context.quadraticCurveTo(
          radius * 0.05,
          -radius * 1.0,
          radius * 0.18,
          -radius * 1.12
        );
        context.stroke();
        context.fillStyle = "#4fae3a";
        context.beginPath();
        context.ellipse(
          radius * 0.32,
          -radius * 0.98,
          radius * 0.22,
          radius * 0.1,
          -0.5,
          0,
          Math.PI * 2
        );
        context.fill();
      }

      // Glossy specular highlight
      context.fillStyle = "rgba(255, 255, 255, 0.38)";
      context.beginPath();
      context.ellipse(
        -radius * 0.38,
        -radius * 0.42,
        radius * 0.2,
        radius * 0.11,
        -0.7,
        0,
        Math.PI * 2
      );
      context.fill();
    };

    const drawFleshFace = (fruitType: FruitTypeSpec, radius: number) => {
      context.fillStyle = fruitType.skinDark;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();

      const fleshRadius = radius * 0.88;
      const fleshGradient = context.createRadialGradient(
        0,
        0,
        fleshRadius * 0.1,
        0,
        0,
        fleshRadius
      );
      fleshGradient.addColorStop(0, fruitType.fleshInner);
      fleshGradient.addColorStop(1, fruitType.fleshOuter);
      context.fillStyle = fleshGradient;
      context.beginPath();
      context.arc(0, 0, fleshRadius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = "rgba(255, 255, 255, 0.5)";
      context.lineWidth = radius * 0.06;
      context.stroke();

      if (fruitType.pattern === "watermelon") {
        context.fillStyle = "#1a1010";
        for (let seedIndex = 0; seedIndex < 8; seedIndex++) {
          const seedAngle = seedIndex * ((Math.PI * 2) / 8) + 0.3;
          context.beginPath();
          context.ellipse(
            Math.cos(seedAngle) * radius * 0.5,
            Math.sin(seedAngle) * radius * 0.5,
            radius * 0.07,
            radius * 0.035,
            seedAngle,
            0,
            Math.PI * 2
          );
          context.fill();
        }
      } else if (fruitType.pattern === "citrus" || fruitType.pattern === "pineapple") {
        context.strokeStyle = "rgba(255, 255, 255, 0.58)";
        context.lineWidth = radius * 0.038;
        for (let segmentIndex = 0; segmentIndex < 8; segmentIndex++) {
          const segmentAngle = segmentIndex * ((Math.PI * 2) / 8);
          context.beginPath();
          context.moveTo(0, 0);
          context.lineTo(
            Math.cos(segmentAngle) * fleshRadius * 0.92,
            Math.sin(segmentAngle) * fleshRadius * 0.92
          );
          context.stroke();
        }
      } else if (fruitType.pattern === "kiwi") {
        context.fillStyle = "#f4fbd8";
        context.beginPath();
        context.arc(0, 0, radius * 0.17, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#1d2410";
        for (let seedIndex = 0; seedIndex < 18; seedIndex++) {
          const seedAngle = seedIndex * ((Math.PI * 2) / 18);
          context.beginPath();
          context.arc(
            Math.cos(seedAngle) * radius * 0.42,
            Math.sin(seedAngle) * radius * 0.42,
            radius * 0.03,
            0,
            Math.PI * 2
          );
          context.fill();
        }
      } else if (fruitType.pattern === "apple" || fruitType.pattern === "papaya") {
        context.fillStyle = fruitType.pattern === "papaya" ? "#7c2d12" : "#efe2a8";
        context.beginPath();
        context.ellipse(0, 0, radius * 0.18, radius * 0.28, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#291509";
        for (const seedOffsetX of [-0.05, 0.05]) {
          context.beginPath();
          context.ellipse(
            radius * seedOffsetX,
            0,
            radius * 0.032,
            radius * 0.07,
            0,
            0,
            Math.PI * 2
          );
          context.fill();
        }
      }
    };

    const drawBomb = (radius: number, nowSeconds: number) => {
      const bodyGradient = context.createRadialGradient(
        -radius * 0.3,
        -radius * 0.3,
        radius * 0.1,
        0,
        0,
        radius
      );
      bodyGradient.addColorStop(0, "#6c6c7a");
      bodyGradient.addColorStop(1, "#0b0b10");
      context.fillStyle = bodyGradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();

      // Pulsing red danger ring
      context.strokeStyle = `rgba(255, 60, 40, ${
        0.5 + Math.sin(nowSeconds * 9) * 0.35
      })`;
      context.lineWidth = radius * 0.09;
      context.beginPath();
      context.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
      context.stroke();

      // Fuse rope
      context.strokeStyle = "#6b4a2a";
      context.lineWidth = radius * 0.12;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(0, -radius * 0.95);
      context.quadraticCurveTo(
        radius * 0.15,
        -radius * 1.25,
        radius * 0.35,
        -radius * 1.3
      );
      context.stroke();

      // Glowing radial fuse spark
      const sparkRadius = radius * (0.22 + Math.random() * 0.14);
      const sparkGradient = context.createRadialGradient(
        radius * 0.35,
        -radius * 1.3,
        0,
        radius * 0.35,
        -radius * 1.3,
        sparkRadius
      );
      sparkGradient.addColorStop(0, "#fff6b0");
      sparkGradient.addColorStop(0.4, "#ffb02e");
      sparkGradient.addColorStop(1, "rgba(255, 80, 20, 0)");
      context.fillStyle = sparkGradient;
      context.beginPath();
      context.arc(radius * 0.35, -radius * 1.3, sparkRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(255, 255, 255, 0.3)";
      context.beginPath();
      context.ellipse(
        -radius * 0.38,
        -radius * 0.42,
        radius * 0.18,
        radius * 0.1,
        -0.7,
        0,
        Math.PI * 2
      );
      context.fill();
    };

    const drawJuiceSplats = () => {
      for (const splat of juiceSplatsRef.current) {
        context.globalAlpha =
          clamp(1 - splat.ageSeconds / splat.lifetimeSeconds, 0, 1) * 0.55;
        context.fillStyle = splat.color;
        context.beginPath();
        context.arc(splat.x, splat.y, splat.radius, 0, Math.PI * 2);
        context.fill();
        for (const droplet of splat.droplets) {
          context.beginPath();
          context.arc(
            splat.x + droplet.offsetX,
            splat.y + droplet.offsetY,
            droplet.radius,
            0,
            Math.PI * 2
          );
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };

    const drawTrail = (nowSeconds: number) => {
      const trailPoints = trailPointsRef.current;
      if (trailPoints.length < 2) return;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      for (let i = 1; i < trailPoints.length; i++) {
        const previousPoint = trailPoints[i - 1];
        const currentPoint = trailPoints[i];
        const freshness = clamp(
          1 - (nowSeconds - currentPoint.bornAtSeconds) / TRAIL_LIFETIME_SECONDS,
          0,
          1
        );
        context.globalCompositeOperation = "lighter";
        context.strokeStyle = `rgba(90, 200, 255, ${freshness * 0.55})`;
        context.lineWidth = 18 * freshness + 2;
        context.beginPath();
        context.moveTo(previousPoint.x, previousPoint.y);
        context.lineTo(currentPoint.x, currentPoint.y);
        context.stroke();

        context.globalCompositeOperation = "source-over";
        context.strokeStyle = `rgba(255, 255, 255, ${freshness})`;
        context.lineWidth = 6 * freshness + 1;
        context.stroke();
      }
      context.restore();
    };

    let animId = 0;
    let previousFrameTimestamp = performance.now();

    const gameLoop = (frameTimestamp: number) => {
      const deltaSeconds = Math.min(
        (frameTimestamp - previousFrameTimestamp) / 1000,
        0.033
      );
      previousFrameTimestamp = frameTimestamp;
      const nowSeconds = frameTimestamp / 1000;
      const { width: viewportWidth, height: viewportHeight } =
        viewportSizeRef.current;

      // ── 1. UPDATE SIMULATION ──
      slowMotionFactorRef.current +=
        (1 - slowMotionFactorRef.current) * Math.min(1, deltaSeconds * 2.5);
      const scaledDeltaSeconds = deltaSeconds * slowMotionFactorRef.current;
      const gravityPixelsPerSecondSquared =
        viewportHeight * GRAVITY_SCREEN_HEIGHTS_PER_SECOND_SQUARED;

      if (!gameOverRef.current && !isPausedForBannerRef.current) {
        const prevSecFloor = Math.floor(elapsedPlaySecondsRef.current);
        elapsedPlaySecondsRef.current += deltaSeconds;
        const nextSecFloor = Math.floor(elapsedPlaySecondsRef.current);
        if (nextSecFloor !== prevSecFloor) {
          setTimeRemainingSec(Math.max(0, 60 - nextSecFloor));
        }
        if (elapsedPlaySecondsRef.current >= 60) {
          triggerEndGame("timeout");
        }
        secondsUntilNextWaveRef.current -= scaledDeltaSeconds;
        if (secondsUntilNextWaveRef.current <= 0) {
          spawnWave();
        }
      }

      for (const body of [
        ...flyingProjectilesRef.current,
        ...fruitHalvesRef.current,
      ]) {
        body.velocityY += gravityPixelsPerSecondSquared * scaledDeltaSeconds;
        body.x += body.velocityX * scaledDeltaSeconds;
        body.y += body.velocityY * scaledDeltaSeconds;
        body.rotation += body.spinSpeed * scaledDeltaSeconds;
      }

      // Side wall bounce for whole projectiles
      for (const proj of flyingProjectilesRef.current) {
        if (proj.x < proj.radius + 6) {
          proj.x = proj.radius + 6;
          proj.velocityX = Math.abs(proj.velocityX) * 0.8;
        } else if (proj.x > viewportWidth - proj.radius - 6) {
          proj.x = viewportWidth - proj.radius - 6;
          proj.velocityX = -Math.abs(proj.velocityX) * 0.8;
        }
      }

      flyingProjectilesRef.current = flyingProjectilesRef.current.filter(
        (projectile) => {
          const hasFallenOffScreen =
            projectile.y > viewportHeight + projectile.radius * 1.5 &&
            projectile.velocityY > 0;
          if (
            hasFallenOffScreen &&
            !projectile.isBomb &&
            !gameOverRef.current &&
            !isPausedForBannerRef.current
          ) {
            remainingLivesRef.current -= 1;
            setRemainingLives(remainingLivesRef.current);
            soundEffects.current.miss();
            triggerHapticSensor([45, 30, 45]);
            addFloatingText(
              "MISS",
              clamp(projectile.x, 60, viewportWidth - 60),
              viewportHeight - 54,
              "#ff4d2e",
              34
            );
            if (remainingLivesRef.current <= 0) {
              triggerEndGame("missed");
            }
          }
          return !hasFallenOffScreen;
        }
      );

      fruitHalvesRef.current = fruitHalvesRef.current.filter(
        (half) => half.y < viewportHeight + half.radius * 2
      );

      for (const particle of juiceParticlesRef.current) {
        particle.velocityY +=
          gravityPixelsPerSecondSquared * 0.8 * scaledDeltaSeconds;
        particle.x += particle.velocityX * scaledDeltaSeconds;
        particle.y += particle.velocityY * scaledDeltaSeconds;
        particle.lifeRemainingSeconds -= scaledDeltaSeconds;
      }
      juiceParticlesRef.current = juiceParticlesRef.current.filter(
        (particle) => particle.lifeRemainingSeconds > 0
      );

      for (const splat of juiceSplatsRef.current) {
        splat.ageSeconds += deltaSeconds;
      }
      juiceSplatsRef.current = juiceSplatsRef.current.filter(
        (splat) => splat.ageSeconds < splat.lifetimeSeconds
      );

      for (const floatingText of floatingTextsRef.current) {
        floatingText.ageSeconds += deltaSeconds;
        floatingText.y -= 50 * deltaSeconds;
      }
      floatingTextsRef.current = floatingTextsRef.current.filter(
        (floatingText) => floatingText.ageSeconds < floatingText.lifetimeSeconds
      );

      trailPointsRef.current = trailPointsRef.current.filter(
        (trailPoint) =>
          nowSeconds - trailPoint.bornAtSeconds < TRAIL_LIFETIME_SECONDS
      );
      screenShakeStrengthRef.current *= Math.pow(0.02, deltaSeconds);
      whiteFlashAlphaRef.current *= Math.pow(0.004, deltaSeconds);

      // ── 2. RENDER SCENE ──
      context.clearRect(0, 0, viewportWidth, viewportHeight);
      context.save();
      if (screenShakeStrengthRef.current > 0.3) {
        context.translate(
          randomBetween(-1, 1) * screenShakeStrengthRef.current,
          randomBetween(-1, 1) * screenShakeStrengthRef.current
        );
      }

      if (backgroundLayerRef.current) {
        context.drawImage(
          backgroundLayerRef.current,
          0,
          0,
          viewportWidth,
          viewportHeight
        );
      }
      drawJuiceSplats();

      for (const half of fruitHalvesRef.current) {
        context.save();
        context.translate(half.x, half.y);
        context.rotate(half.rotation);
        context.beginPath();
        context.rect(
          -half.radius * 2,
          half.side > 0 ? 0 : -half.radius * 2,
          half.radius * 4,
          half.radius * 2
        );
        context.clip();
        drawFleshFace(half.fruitType, half.radius);
        context.restore();
      }

      for (const projectile of flyingProjectilesRef.current) {
        context.save();
        context.translate(projectile.x, projectile.y);
        context.rotate(projectile.rotation);
        if (projectile.isBomb) {
          drawBomb(projectile.radius, nowSeconds);
        } else {
          drawFruitBody(projectile.fruitType, projectile.radius);
        }
        context.restore();
      }

      for (const particle of juiceParticlesRef.current) {
        context.globalAlpha = clamp(
          particle.lifeRemainingSeconds / particle.lifetimeSeconds,
          0,
          1
        );
        context.fillStyle = particle.color;
        if (particle.isConfetti) {
          context.fillRect(
            particle.x,
            particle.y,
            particle.radius * 1.7,
            particle.radius
          );
        } else {
          context.beginPath();
          context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;

      drawTrail(nowSeconds);

      context.textAlign = "center";
      context.lineJoin = "round";
      for (const floatingText of floatingTextsRef.current) {
        const progress = floatingText.ageSeconds / floatingText.lifetimeSeconds;
        context.globalAlpha = clamp(1.6 - progress * 1.6, 0, 1);
        const popScale =
          1 + Math.sin(Math.min(progress * 3, 1) * Math.PI) * 0.25;
        context.font = `900 ${Math.round(
          floatingText.fontSize * popScale
        )}px 'Lilita One', Impact, sans-serif`;
        context.lineWidth = 6;
        context.strokeStyle = "rgba(40, 8, 0, 0.85)";
        context.strokeText(floatingText.text, floatingText.x, floatingText.y);
        context.fillStyle = floatingText.color;
        context.fillText(floatingText.text, floatingText.x, floatingText.y);
      }
      context.globalAlpha = 1;
      context.restore();

      if (whiteFlashAlphaRef.current > 0.01) {
        context.fillStyle = `rgba(255, 244, 220, ${whiteFlashAlphaRef.current})`;
        context.fillRect(0, 0, viewportWidth, viewportHeight);
      }

      animId = window.requestAnimationFrame(gameLoop);
    };

    animId = window.requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener("resize", syncCanvasDimensions);
      window.cancelAnimationFrame(animId);
    };
  }, [addFloatingText, buildBackgroundLayer, spawnWave, triggerEndGame]);

  const currentStallConfig = STALL_LEVELS[stallIdx] || STALL_LEVELS[0];

  const handleShareScore = async () => {
    const shareText = `🍉🔪 I just scored ${score} POINTS (Stage ${
      stallIdx + 1
    } • ${currentStallConfig.name}) in Fruit Slash on SwiftData Arena! Slice fruits & win Free Data Bundles: ${
      window.location.origin
    }/challenges`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Fruit Slash — SwiftData Arena",
          text: shareText,
        });
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
  const slashFit = screenFit.computeBoardStageMetrics("slash", {
    reservedTopPx: 38,
  });

  return (
    <div
      style={{ fontFamily: "'Lilita One', 'Trebuchet MS', Impact, sans-serif" }}
      className="w-full h-full flex-1 min-h-0 flex flex-col rounded-none sm:rounded-[24px] bg-[#120a07] border-0 sm:border-2 border-[#3a2014] shadow-[0_28px_70px_rgba(0,0,0,0.9)] overflow-hidden select-none"
    >
      {/* ── Top Utility Bar: < Games | FRUIT SLASH | Haptics & Sound Controls ── */}
      <div className="shrink-0 px-3 py-2 bg-[#1a0e09] border-b border-amber-500/15 flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => (onBackToLobby ? onBackToLobby() : handleRestartGame())}
          className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-xs font-sans font-bold text-amber-100 flex items-center gap-1 transition-all cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Games
        </button>

        <div className="flex items-center gap-1.5">
          <div className="text-base sm:text-lg tracking-wider bg-gradient-to-b from-[#fff6c9] via-[#ffd23c] to-[#ff7a1c] bg-clip-text text-transparent drop-shadow-[0_2px_0_#7a1f08]">
            FRUIT SLASH
          </div>
          <span
            title={`Auto-fitted for ${screenFit.deviceModelHint} (${slashFit.slashCanvasHeightPx}px canvas)`}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-400/30 text-[8px] font-mono font-bold text-amber-300"
          >
            📱 {slashFit.fitSummaryLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = !vibrationEnabled;
              setVibrationEnabled(next);
              setGameSensoryPreferences({ vibrationEnabled: next });
              if (next) triggerHapticSensor("slice");
            }}
            className={`p-1.5 rounded-full border transition-all cursor-pointer ${
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
            className="p-1.5 rounded-full border border-white/10 text-amber-300 hover:bg-white/5 cursor-pointer"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* ── 5-Stage Dojo Progress Bar & Challenger Target Pill ── */}
      <div className="shrink-0 px-3.5 py-1.5 bg-[#21110b] border-b border-amber-500/15 flex items-center justify-between gap-2 font-sans">
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
                      ? "bg-[#ffc93c]"
                      : current
                      ? "bg-gradient-to-r from-[#fff1b8] via-[#ffc93c] to-[#ff4d2e] animate-pulse"
                      : "bg-[#3d2318]"
                  }`}
                />
              );
            })}
          </div>
          <p className="text-[10px] font-bold text-amber-100/85">
            Stage {currentStallConfig.level}/5 · {currentStallConfig.name}
            {mode !== "p2p" && (
              <span className="ml-1.5 text-[9px] text-emerald-300 font-semibold">
                • Beat {effectiveOpponentName} ({aiTargetScore.current} pts)
              </span>
            )}
          </p>
        </div>

        {bestCombo >= 2 && (
          <div className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-[10px] font-black text-amber-300 flex items-center gap-1">
            <Flame className="w-3 h-3 text-orange-400" />
            <span>MAX {bestCombo}x</span>
          </div>
        )}
      </div>

      {/* ── Main Full-Screen Playfield Canvas Container with Floating Arcade HUD ── */}
      <div className="relative w-full flex-1 min-h-0 h-full bg-[#170b06] overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          className="w-full h-full block touch-none cursor-crosshair"
        />

        {/* ── Floating Fruit Slash Gold HUD (Score + Best + ✕ ✕ ✕ Lives) ── */}
        <div className="pointer-events-none absolute top-3 inset-x-4 flex items-start justify-between">
          <div>
            <div
              style={{
                background: "linear-gradient(180deg, #fff1b8, #ffc93c 60%, #ff9d2e)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                filter: "drop-shadow(0 3px 0 rgba(90, 30, 0, 0.78))",
              }}
              className="text-4xl sm:text-5xl leading-none tracking-wide"
            >
              {score}
            </div>
            <div className="text-xs tracking-[0.16em] text-[#fff1b8]/80 mt-0.5 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
              BEST {Math.max(bestScore, score)}
            </div>
          </div>

          {/* 60s Blitz Countdown Timer + 3 Life Crosses (✕ ✕ ✕) */}
          <div className="flex items-center gap-2.5">
            <div
              className={`px-2.5 py-1 rounded-full border text-xs font-sans font-black flex items-center gap-1 shadow-md ${
                timeRemainingSec <= 12
                  ? "bg-rose-600/90 border-rose-300 text-white animate-pulse"
                  : "bg-black/65 border-amber-400/40 text-[#ffd23c]"
              }`}
            >
              <span>⏱️</span>
              <span>
                {Math.floor(timeRemainingSec / 60)}:
                {String(timeRemainingSec % 60).padStart(2, "0")}
              </span>
            </div>
            {[0, 1, 2].map((lifeIndex) => {
              const isLost = lifeIndex >= remainingLives;
              return (
                <span
                  key={lifeIndex}
                  className={`text-2xl sm:text-3xl transition-all duration-250 drop-shadow-[0_2px_0_rgba(0,0,0,0.65)] ${
                    isLost
                      ? "text-[#ff4d2e] scale-85 rotate-12 opacity-90"
                      : "text-[#ffe9c2] scale-100"
                  }`}
                >
                  ✕
                </span>
              );
            })}
          </div>
        </div>

        {/* Bottom Swipe Hint Pill */}
        {showSwipeHint && !gameOverReason && (
          <div className="pointer-events-none absolute bottom-5 inset-x-0 flex justify-center">
            <div className="px-4 py-1.5 rounded-full bg-black/55 backdrop-blur-sm border border-amber-300/25 text-[#fff1b8] text-xs tracking-wider animate-pulse flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Swipe to slice. Don’t touch the bombs!</span>
            </div>
          </div>
        )}

        {/* Stage Intro & STAGE CLEARED! Center Overlay */}
        {bannerOverlay && !gameOverReason && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 bg-black/30 backdrop-blur-[1px]">
            <div className="text-center space-y-1.5 animate-in zoom-in-95 duration-200">
              {bannerOverlay.type === "stall_cleared" ? (
                <>
                  <p className="text-sm tracking-[0.22em] text-[#fff1b8] drop-shadow-[0_3px_0_#7a1f08]">
                    STAGE CLEARED!
                  </p>
                  <p
                    style={{
                      background:
                        "linear-gradient(180deg, #fff6c9 0%, #ffd23c 45%, #ff7a1c 100%)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      filter:
                        "drop-shadow(0 5px 0 #7a1f08) drop-shadow(0 12px 22px rgba(255,90,20,0.45))",
                    }}
                    className="text-6xl leading-none"
                  >
                    +{bannerOverlay.bonus}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs tracking-[0.22em] text-[#ffc93c] drop-shadow-[0_2px_0_#7a1f08]">
                    STAGE {bannerOverlay.level}
                  </p>
                  <h3
                    style={{
                      background:
                        "linear-gradient(180deg, #fff6c9 0%, #ffd23c 45%, #ff7a1c 100%)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      filter:
                        "drop-shadow(0 4px 0 #7a1f08) drop-shadow(0 10px 18px rgba(255,90,20,0.45))",
                    }}
                    className="text-3xl sm:text-4xl tracking-wide"
                  >
                    {bannerOverlay.title}
                  </h3>
                  <p className="text-xs font-sans font-bold text-[#fff1b8]/90 drop-shadow">
                    {bannerOverlay.subtitle}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Upgraded Fruit Slash Arcade Glass Overlay Card on Game Over / Victory ── */}
        {gameOverReason && (
          <div className="absolute inset-0 bg-black/65 backdrop-blur-md flex items-center justify-center p-5 animate-in fade-in duration-200">
            <div
              style={{
                background: "rgba(24, 12, 8, 0.86)",
                boxShadow:
                  "0 30px 80px rgba(0, 0, 0, 0.7), inset 0 0 40px rgba(255, 160, 60, 0.12)",
              }}
              className="w-full max-w-[340px] rounded-[28px] border-2 border-[#ffd696]/30 p-6 text-center space-y-4 text-white"
            >
              <div className="space-y-1">
                <h2
                  style={{
                    background:
                      gameOverReason === "cleared_all"
                        ? "linear-gradient(180deg, #bbf7d0 0%, #4ade80 50%, #16a34a 100%)"
                        : "linear-gradient(180deg, #fff6c9 0%, #ffd23c 45%, #ff7a1c 100%)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                    filter:
                      "drop-shadow(0 4px 0 #7a1f08) drop-shadow(0 10px 20px rgba(255, 90, 20, 0.45))",
                  }}
                  className="text-4xl sm:text-5xl leading-none tracking-wider"
                >
                  {gameOverReason === "cleared_all" ? "GRANDMASTER!" : "GAME OVER"}
                </h2>
                <p className="text-xs font-sans font-bold text-amber-200/80">
                  {gameOverReason === "bomb"
                    ? "💣 You sliced a bomb!"
                    : gameOverReason === "missed"
                    ? "🍉 3 fruits dropped!"
                    : gameOverReason === "timeout"
                    ? "⏱️ 60-Second Blitz Clock Expired!"
                    : "🏆 All 5 Dojo Market Stages Cleared!"}
                </p>
              </div>

              <div>
                <p className="text-xl tracking-wider text-[#fff1b8]">
                  SCORE {score} · BEST {Math.max(bestScore, score)}
                </p>
                {score >= bestScore && score > 0 && (
                  <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/40 text-[10px] font-sans font-black text-amber-300">
                    ★ NEW BEST RECORD!
                  </span>
                )}
              </div>

              {/* 3 Stat Boxes */}
              <div className="grid grid-cols-3 gap-2 font-sans">
                <div className="p-2.5 rounded-2xl bg-white/[0.06] border border-white/10">
                  <p className="text-base font-black text-[#fff1b8]">{totalSliced}</p>
                  <p className="text-[10px] font-semibold text-amber-200/60">sliced</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-white/[0.06] border border-white/10">
                  <p className="text-base font-black text-[#ffc93c]">{bestCombo}x</p>
                  <p className="text-[10px] font-semibold text-amber-200/60">best combo</p>
                </div>
                <div className="p-2.5 rounded-2xl bg-white/[0.06] border border-white/10">
                  <p className="text-base font-black text-emerald-300">
                    Lv.{stallIdx + 1}
                  </p>
                  <p className="text-[10px] font-semibold text-amber-200/60">stage</p>
                </div>
              </div>

              {/* Challenger Comparison Pill */}
              {mode !== "p2p" && (
                <div
                  className={`px-3 py-2 rounded-xl text-xs font-sans font-bold flex items-center justify-center gap-1.5 border ${
                    score >= aiTargetScore.current
                      ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200"
                      : "bg-amber-500/15 border-amber-400/30 text-amber-200"
                  }`}
                >
                  <Trophy className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>
                    {score >= aiTargetScore.current
                      ? `You beat ${effectiveOpponentName} (${aiTargetScore.current} pts)!`
                      : `${effectiveOpponentName} scored ${aiTargetScore.current} pts — one more round?`}
                  </span>
                </div>
              )}

              {/* Primary Fruit Slash Arcade Play Again + Share Buttons */}
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleRestartGame}
                  style={{
                    background: "linear-gradient(180deg, #ff8a3d, #e8341c)",
                    boxShadow:
                      "0 5px 0 #8f1a0b, 0 12px 26px rgba(232, 52, 28, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.45)",
                    textShadow: "0 2px 0 rgba(90, 10, 0, 0.6)",
                  }}
                  className="w-full py-3 rounded-full text-xl tracking-widest text-white flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-1 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span>PLAY AGAIN</span>
                </button>

                <button
                  type="button"
                  onClick={handleShareScore}
                  className="w-full py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-sans font-black text-amber-100 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{copiedShare ? "Copied Score Link!" : "Share Score"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
