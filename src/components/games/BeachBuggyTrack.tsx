import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";
import {
  triggerHapticSensor,
  playLevelUpFanfare,
  playTurnNotificationSound,
  getGameSensoryPreferences,
} from "@/lib/game-sensory-engine";
import {
  Trophy,
  Wrench,
  Flame,
  Shield,
  Gauge,
  Play,
  RotateCcw,
  ArrowLeft,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Crosshair,
} from "lucide-react";

export type GhanaTrackId = "labadi" | "aburi" | "motorway";
export type GhanaVehicleId = "buggy" | "pragya" | "trotro" | "kantanka";

export interface BuggyRaceBoardState {
  trackId: GhanaTrackId;
  laps: number;
  creatorProgress: number;
  opponentProgress: number;
  creatorTime: number;
  opponentTime: number;
  creatorRank: number;
  opponentRank: number;
  creatorFinished: boolean;
  opponentFinished: boolean;
  creatorWrecked?: boolean;
  opponentWrecked?: boolean;
  moveCount: number;
  winner?: "creator" | "opponent" | "draw" | null;
}

export const INITIAL_BUGGY_STATE: BuggyRaceBoardState = {
  trackId: "labadi",
  laps: 3,
  creatorProgress: 0,
  opponentProgress: 0,
  creatorTime: 0,
  opponentTime: 0,
  creatorRank: 1,
  opponentRank: 2,
  creatorFinished: false,
  opponentFinished: false,
  creatorWrecked: false,
  opponentWrecked: false,
  moveCount: 0,
  winner: null,
};

interface SuameSaveData {
  bank: number;
  best: number;
  vehicle: GhanaVehicleId;
  track: GhanaTrackId;
  up: {
    eng: number;
    nit: number;
    arm: number;
  };
}

const SUAME_SAVE_KEY = "swiftdata_ghana_buggy_save_v1";

const GHANA_TRACKS: {
  id: GhanaTrackId;
  name: string;
  subtitle: string;
  badge: string;
  skyTop: string;
  skyMid: string;
  skyBot: string;
  hill1: string;
  hill2: string;
  groundLight: string;
  groundDark: string;
  shoulderLight: string;
  shoulderDark: string;
  waterLight: string;
  waterDark: string;
  roadLight: string;
  roadDark: string;
  fogRgb: string;
}[] = [
  {
    id: "labadi",
    name: "Labadi & Kokrobite Beach",
    subtitle: "Atlantic Golden Sand • Coconut Palms • Gulf of Guinea Waves",
    badge: "🏖️ COASTAL",
    skyTop: "#0e5ca8",
    skyMid: "#52b6e8",
    skyBot: "#fff2c6",
    hill1: "#4a8fb5",
    hill2: "#2c6d91",
    groundLight: "#f4dca6",
    groundDark: "#e8cb8c",
    shoulderLight: "#d9b97a",
    shoulderDark: "#c9a663",
    waterLight: "#12b8d4",
    waterDark: "#0b8ba3",
    roadLight: "#4c4d57",
    roadDark: "#41424b",
    fogRgb: "225, 242, 250",
  },
  {
    id: "aburi",
    name: "Aburi Hills & Akuapem Ridge",
    subtitle: "Steep Mountain Hairpins • Lush Ridge Forest • Laterite Shoulders",
    badge: "⛰️ MOUNTAIN",
    skyTop: "#0a3f44",
    skyMid: "#3c9989",
    skyBot: "#d8f3dc",
    hill1: "#2d6a4f",
    hill2: "#1b4332",
    groundLight: "#3b7a57",
    groundDark: "#2e6446",
    shoulderLight: "#c46d3b",
    shoulderDark: "#a85729",
    waterLight: "#1e6091",
    waterDark: "#184e77",
    roadLight: "#42484f",
    roadDark: "#373c42",
    fogRgb: "216, 243, 220",
  },
  {
    id: "motorway",
    name: "Tema Motorway & Black Star Sprint",
    subtitle: "Accra Sunset Highway • Kente Curbs • High-Speed Straightaways",
    badge: "🌉 HIGHWAY",
    skyTop: "#240a36",
    skyMid: "#942951",
    skyBot: "#ffb352",
    hill1: "#4a2559",
    hill2: "#2c1338",
    groundLight: "#8c6d53",
    groundDark: "#785b42",
    shoulderLight: "#a68568",
    shoulderDark: "#917156",
    waterLight: "#284b63",
    waterDark: "#1d3557",
    roadLight: "#343740",
    roadDark: "#2a2d35",
    fogRgb: "255, 210, 175",
  },
];

const GHANA_VEHICLES: {
  id: GhanaVehicleId;
  name: string;
  tagline: string;
  color: string;
  accent: string;
  speedBonus: number;
  steerBonus: number;
  armorBonus: number;
}[] = [
  {
    id: "buggy",
    name: "Labadi Sand Buggy",
    tagline: "Twin-Turbo Coastal Racer with Kente Wing",
    color: "#ff6a1a",
    accent: "#ffd23a",
    speedBonus: 1.0,
    steerBonus: 1.0,
    armorBonus: 1.0,
  },
  {
    id: "pragya",
    name: "Yellow-Yellow Pragya",
    tagline: "Kumasi Super-Agile 3-Wheeler Canopy",
    color: "#facc15",
    accent: "#16a34a",
    speedBonus: 0.98,
    steerBonus: 1.18,
    armorBonus: 0.94,
  },
  {
    id: "trotro",
    name: "VIP Sprinter Trotro",
    tagline: "Accra–Kumasi Highway Express • Heavy Armor",
    color: "#e11d48",
    accent: "#f8fafc",
    speedBonus: 1.03,
    steerBonus: 0.95,
    armorBonus: 1.18,
  },
  {
    id: "kantanka",
    name: "Kantanka Omama 4×4",
    tagline: "Ghanaian Off-Road Beast • Zero Off-Road Slowdown",
    color: "#10b981",
    accent: "#fbbf24",
    speedBonus: 1.04,
    steerBonus: 1.05,
    armorBonus: 1.22,
  },
];

const RIVAL_DRIVERS = [
  { col: "#ff3b3b", name: "Kwame Turbo" },
  { col: "#2f7cff", name: "Abena Drift" },
  { col: "#ffd400", name: "Nii Labadi" },
  { col: "#b05cff", name: "Torgbui Speed" },
  { col: "#19c37d", name: "Kofi Pragya" },
];

const GHANA_ADS = [
  ["SWIFTDATA 1GB", "#d97706"],
  ["MTN MOMO FAST", "#eab308"],
  ["SUAME TURBO", "#dc2626"],
  ["SOBOLO NITRO", "#9333ea"],
  ["KEJETIA EXPRESS", "#059669"],
  ["CHALE WOTE GP", "#0284c7"],
];

const UPGRADE_META: Record<
  "eng" | "nit" | "arm",
  { title: string; subtitle: string }
> = {
  eng: {
    title: "Suame V8 Engine",
    subtitle: "Faster acceleration & higher top KM/H speed",
  },
  nit: {
    title: "Shito & Sobolo N₂",
    subtitle: "Longer flame nitro boost & faster recharge",
  },
  arm: {
    title: "Kantanka Armor",
    subtitle: "Absorbs crash damage from rocks, palms & rivals",
  },
};

const upgradeCost = (level: number) => 250 * (level + 1) * (level + 1);

interface BeachBuggyTrackProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  initialState?: Partial<BuggyRaceBoardState>;
  onStateChange?: (state: BuggyRaceBoardState) => void;
  onMatchComplete?: (winner: "creator" | "opponent" | "draw") => void;
  onPointsEarned?: (points: number, reason: string) => void;
  playerLevel?: number;
  onBackToLobby?: () => void;
  onRematch?: () => void;
  onPlayAnotherGame?: () => void;
}

export const BeachBuggyTrack: React.FC<BeachBuggyTrackProps> = ({
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
  onRematch,
  onPlayAnotherGame,
}) => {
  const screenFit = useDeviceScreenFit();
  const racingMetrics = screenFit.computeRacingStageMetrics({ forcedLandscape: true });

  const stageRootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [saveData, setSaveData] = useState<SuameSaveData>(() => {
    const fallback: SuameSaveData = {
      bank: 300,
      best: 0,
      vehicle: "buggy",
      track: (initialState?.trackId as GhanaTrackId) || "labadi",
      up: { eng: 0, nit: 0, arm: 0 },
    };
    try {
      const raw = localStorage.getItem(SUAME_SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...fallback,
          ...parsed,
          up: { ...fallback.up, ...(parsed.up || {}) },
        };
      }
    } catch {
      // ignore
    }
    return fallback;
  });

  const persistSave = useCallback((next: SuameSaveData) => {
    setSaveData(next);
    try {
      localStorage.setItem(SUAME_SAVE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const [uiScreen, setUiScreen] = useState<"menu" | "racing" | "garage" | "end">(
    "menu"
  );
  const [muted, setMuted] = useState<boolean>(
    () => !getGameSensoryPreferences().soundEnabled
  );
  const [autoGas, setAutoGas] = useState<boolean>(true);
  const [steeringMode, setSteeringMode] = useState<"wheel" | "tilt" | "arrows">(
    () => {
      try {
        const saved = localStorage.getItem("swiftdata_buggy_steering_mode");
        if (saved === "wheel" || saved === "tilt" || saved === "arrows") {
          return saved;
        }
      } catch {
        // ignore
      }
      return "wheel";
    }
  );
  const [tiltSensitivity, setTiltSensitivity] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("swiftdata_buggy_tilt_sens"));
      if (saved === 1.0 || saved === 1.4 || saved === 1.8) return saved;
    } catch {
      // ignore
    }
    return 1.4;
  });
  const [wheelAngleDeg, setWheelAngleDeg] = useState<number>(0);
  const [tiltAngleDeg, setTiltAngleDeg] = useState<number>(0);
  const [sensorActive, setSensorActive] = useState<boolean>(false);
  const [endSummary, setEndSummary] = useState<{
    won: boolean;
    wrecked: boolean;
    timedOut?: boolean;
    rank: number;
    lap: number;
    raceTime: number;
    prizeCoins: number;
    collectedCoins: number;
    newBest: boolean;
  } | null>(null);

  const saveRef = useRef<SuameSaveData>(saveData);
  saveRef.current = saveData;

  const mutedRef = useRef<boolean>(muted);
  mutedRef.current = muted;

  const autoGasRef = useRef<boolean>(autoGas);
  autoGasRef.current = autoGas;

  const steeringModeRef = useRef<"wheel" | "tilt" | "arrows">(steeringMode);
  steeringModeRef.current = steeringMode;

  const tiltSensitivityRef = useRef<number>(tiltSensitivity);
  tiltSensitivityRef.current = tiltSensitivity;

  const steerAxisRef = useRef<number>(0);
  const wheelDraggingRef = useRef<boolean>(false);
  const wheelPadRef = useRef<HTMLDivElement | null>(null);

  // Motion Sensor Calibration & Smoothing Refs
  const rawSensorDegRef = useRef<number>(0);
  const tiltZeroOffsetDegRef = useRef<number>(0);
  const smoothedTiltDegRef = useRef<number>(0);

  const calibrateMotionCenter = useCallback(() => {
    triggerHapticSensor("tap");
    tiltZeroOffsetDegRef.current = rawSensorDegRef.current;
    smoothedTiltDegRef.current = 0;
    steerAxisRef.current = 0;
    setTiltAngleDeg(0);
  }, []);

  const cycleTiltSensitivity = useCallback(() => {
    triggerHapticSensor("tap");
    setTiltSensitivity((prev) => {
      const next = prev === 1.0 ? 1.4 : prev === 1.4 ? 1.8 : 1.0;
      try {
        localStorage.setItem("swiftdata_buggy_tilt_sens", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleFullscreenLandscape = useCallback(async () => {
    triggerHapticSensor("tap");
    try {
      const docAny = document as any;
      const elAny = (stageRootRef.current || document.documentElement) as any;
      if (!document.fullscreenElement && !docAny.webkitFullscreenElement) {
        if (elAny.requestFullscreen) {
          await elAny.requestFullscreen();
        } else if (elAny.webkitRequestFullscreen) {
          await elAny.webkitRequestFullscreen();
        }
        try {
          await (window.screen as any)?.orientation?.lock?.("landscape");
        } catch {
          // ignore
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (docAny.webkitExitFullscreen) {
          await docAny.webkitExitFullscreen();
        }
      }
    } catch {
      // ignore fullscreen restriction
    }
  }, []);

  const changeSteeringMode = useCallback(
    async (nextMode: "wheel" | "tilt" | "arrows") => {
      triggerHapticSensor("tap");
      if (nextMode === "tilt") {
        try {
          const DevOrient = (window as any).DeviceOrientationEvent;
          if (
            DevOrient &&
            typeof DevOrient.requestPermission === "function"
          ) {
            await DevOrient.requestPermission();
          }
          const DevMotion = (window as any).DeviceMotionEvent;
          if (
            DevMotion &&
            typeof DevMotion.requestPermission === "function"
          ) {
            await DevMotion.requestPermission();
          }
        } catch {
          // ignore iOS permission error on non-HTTPS or desktop
        }
      }
      steerAxisRef.current = 0;
      setWheelAngleDeg(0);
      setTiltAngleDeg(0);
      setSteeringMode(nextMode);
      try {
        localStorage.setItem("swiftdata_buggy_steering_mode", nextMode);
      } catch {
        // ignore
      }
    },
    []
  );

  // Attempt hardware landscape lock on mount
  useEffect(() => {
    try {
      const orient = (window.screen as any)?.orientation;
      if (orient && typeof orient.lock === "function") {
        orient.lock("landscape").catch(() => {});
      }
    } catch {
      // ignore
    }
    return () => {
      try {
        const orient = (window.screen as any)?.orientation;
        if (orient && typeof orient.unlock === "function") {
          orient.unlock();
        }
      } catch {
        // ignore
      }
    };
  }, []);

  // 4-Orientation Calibrated Motion Sensor (DeviceOrientation + DeviceMotion Gravity Vector Fallback)
  useEffect(() => {
    if (steeringMode !== "tilt") {
      steerAxisRef.current = 0;
      setTiltAngleDeg(0);
      return;
    }

    let lastOrientationEventTs = 0;

    const applyMeasuredTiltDeg = (measuredDeg: number) => {
      rawSensorDegRef.current = measuredDeg;
      const calibrated = measuredDeg - tiltZeroOffsetDegRef.current;
      // Exponential Moving Average (EMA) low-pass filter to eliminate hand jitter
      smoothedTiltDegRef.current =
        smoothedTiltDegRef.current * 0.72 + calibrated * 0.28;

      const clampedDeg = Math.max(-36, Math.min(36, smoothedTiltDegRef.current));
      const deadzoneDeg =
        Math.abs(clampedDeg) < 1.8
          ? 0
          : clampedDeg - Math.sign(clampedDeg) * 1.8;
      const maxSteerDeg = 22 / Math.max(0.8, tiltSensitivityRef.current);
      const normalized = Math.max(-1, Math.min(1, deadzoneDeg / maxSteerDeg));

      steerAxisRef.current = normalized;
      setTiltAngleDeg(Math.round(clampedDeg));
      setSensorActive(true);
    };

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null && e.gamma === null) return;
      lastOrientationEventTs = performance.now();
      const beta = Number(e.beta || 0); // front-back tilt [-180, 180]
      const gamma = Number(e.gamma || 0); // left-right tilt [-90, 90]
      const screenAngle =
        Number((window.screen as any)?.orientation?.angle) ||
        Number((window as any).orientation) ||
        0;

      let rawTiltDeg = 0;
      if (screenFit.isPortraitViewport) {
        // Stage is rotated 90deg clockwise on a portrait phone:
        // If user holds phone like a landscape wheel, tilting along the long edge changes beta;
        // if user tilts left/right in portrait, gamma changes. Pick whichever axis they are actively tilting!
        rawTiltDeg = Math.abs(beta) > Math.abs(gamma) * 1.15 ? beta : gamma;
      } else if (screenAngle === 90) {
        rawTiltDeg = beta;
      } else if (screenAngle === -90 || screenAngle === 270) {
        rawTiltDeg = -beta;
      } else if (screenAngle === 180) {
        rawTiltDeg = -gamma;
      } else {
        rawTiltDeg = Math.abs(gamma) > Math.abs(beta) ? gamma : beta;
      }

      applyMeasuredTiltDeg(rawTiltDeg);
    };

    // Fallback for Android devices that expose accelerometer (DeviceMotion) without gyroscope
    const handleMotion = (e: DeviceMotionEvent) => {
      if (performance.now() - lastOrientationEventTs < 250) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc || (acc.x === null && acc.y === null)) return;
      const ax = Number(acc.x || 0);
      const ay = Number(acc.y || 0);
      const screenAngle =
        Number((window.screen as any)?.orientation?.angle) ||
        Number((window as any).orientation) ||
        0;

      let rawTiltDeg = 0;
      if (screenFit.isPortraitViewport) {
        const degX = (-ax / 9.81) * 45;
        const degY = (ay / 9.81) * 45;
        rawTiltDeg = Math.abs(degY) > Math.abs(degX) * 1.2 ? degY : degX;
      } else if (screenAngle === 90) {
        rawTiltDeg = (ay / 9.81) * 45;
      } else if (screenAngle === -90 || screenAngle === 270) {
        rawTiltDeg = (-ay / 9.81) * 45;
      } else {
        rawTiltDeg = (-ax / 9.81) * 45;
      }

      applyMeasuredTiltDeg(rawTiltDeg);
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    window.addEventListener("devicemotion", handleMotion, true);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("devicemotion", handleMotion, true);
    };
  }, [steeringMode, screenFit.isPortraitViewport]);

  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;

  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const onMatchCompleteRef = useRef(onMatchComplete);
  onMatchCompleteRef.current = onMatchComplete;

  const onPointsEarnedRef = useRef(onPointsEarned);
  onPointsEarnedRef.current = onPointsEarned;

  const keysRef = useRef<Record<string, number>>({
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    boost: 0,
  });

  const startRaceFnRef = useRef<(() => void) | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const engineOscRef = useRef<OscillatorNode | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);
  const engineFilterRef = useRef<BiquadFilterNode | null>(null);

  const ensureAudioStarted = useCallback(() => {
    if (mutedRef.current || audioCtxRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ac = new Ctx();
      const eo = ac.createOscillator();
      eo.type = "sawtooth";
      const ef = ac.createBiquadFilter();
      ef.type = "lowpass";
      ef.frequency.value = 500;
      const eg = ac.createGain();
      eg.gain.value = 0;
      eo.connect(ef);
      ef.connect(eg);
      eg.connect(ac.destination);
      eo.start();
      audioCtxRef.current = ac;
      engineOscRef.current = eo;
      engineFilterRef.current = ef;
      engineGainRef.current = eg;
    } catch {
      // ignore audio restrictions
    }
  }, []);

  const playBeep = useCallback((freq: number, dur = 0.15, vol = 0.08) => {
    if (mutedRef.current) return;
    const ac = audioCtxRef.current;
    if (!ac) return;
    try {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "square";
      o.frequency.value = freq;
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = cv.width || 960;
    let H = cv.height || 540;
    let HY = Math.floor(H * 0.44);

    const segL = 200;
    const roadW = 2200;
    const lanes = 3;
    const drawN = 230;
    const camH = 1100;
    const camD = 1 / Math.tan((50 * Math.PI) / 180);
    const playerZ = camH * camD;
    const MAX = 12000;
    const ACC = MAX / 4.35;
    const BRK = MAX * 0.85;
    const DEC = MAX / 5;
    const OFFDEC = MAX / 2.2;
    const OFFLIM = MAX * 0.42;
    const CENT = 0.31;
    const LAPS = 3;

    let segs: any[] = [];
    let N = 0;
    let trackLen = 1;
    let seed = 7;

    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp = (v: number, a: number, b: number) =>
      Math.max(a, Math.min(b, v));
    const eIn = (a: number, b: number, p: number) => a + (b - a) * p * p;
    const eIO = (a: number, b: number, p: number) =>
      a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
    const lastY = () => (segs.length ? segs[segs.length - 1].p2.world.y : 0);

    function addSeg(c: number, y: number) {
      const n = segs.length;
      segs.push({
        i: n,
        curve: c,
        p1: { world: { y: lastY(), z: n * segL }, camera: {}, screen: {} },
        p2: { world: { y, z: (n + 1) * segL }, camera: {}, screen: {} },
        light: Math.floor(n / 4) % 2,
        sprites: [],
        cars: [],
        skidmarks: [] as number[],
      });
    }

    function road(e: number, h: number, l: number, c: number, y: number) {
      e *= 3;
      h *= 3;
      l *= 3;
      const s = lastY();
      const en = s + y * 6 * segL;
      const t = e + h + l;
      for (let n = 0; n < e; n++) addSeg(eIn(0, c, n / e), eIO(s, en, n / t));
      for (let n = 0; n < h; n++) addSeg(c, eIO(s, en, (e + n) / t));
      for (let n = 0; n < l; n++)
        addSeg(eIO(c, 0, n / l), eIO(s, en, (e + h + n) / t));
    }

    function buildTrack(trackId: GhanaTrackId) {
      segs = [];
      seed = trackId === "aburi" ? 19 : trackId === "motorway" ? 31 : 7;
      const hillMult =
        trackId === "aburi" ? 1.45 : trackId === "motorway" ? 0.55 : 1.0;
      const curveMult =
        trackId === "aburi" ? 1.2 : trackId === "motorway" ? 0.85 : 1.0;

      road(20, 30, 20, 0, 0);
      road(30, 40, 30, 3 * curveMult, 0);
      road(20, 20, 20, 0, 5 * hillMult);
      road(20, 25, 20, -4 * curveMult, -4 * hillMult);
      road(30, 30, 30, 0, 0);
      road(25, 40, 25, 5 * curveMult, 3 * hillMult);
      road(20, 20, 20, -2 * curveMult, -3 * hillMult);
      road(30, 50, 30, -5 * curveMult, 0);
      road(20, 40, 20, 0, 4 * hillMult);
      road(25, 30, 25, 4 * curveMult, -4 * hillMult);
      road(20, 20, 20, 0, 0);
      road(30, 30, 30, 0, -lastY() / (6 * segL) || 0);

      N = segs.length;
      trackLen = N * segL;

      const T = ["palm", "palm", "umb", "rock", "hut", "palm", "sign"];
      for (let i = 20; i < N - 10; i += 4 + Math.floor(rnd() * 5)) {
        const t = T[Math.floor(rnd() * T.length)];
        const side = rnd() < 0.5 ? -1 : 1;
        let o = side * (1.35 + rnd() * 1.1);
        let sz = 3200;
        let w = 0.28;
        if (t === "umb") {
          sz = 2400;
          w = 0.25;
        }
        if (t === "rock") {
          sz = 1100;
          w = 0.4;
          o = side * (1.15 + rnd() * 0.9);
        }
        if (t === "hut") {
          sz = 3600;
          w = 0.7;
          o = side * (2.1 + rnd() * 0.5);
        }
        if (t === "sign") {
          sz = 2200;
          w = 0.5;
          o = side * (1.55 + rnd() * 0.5);
        }
        if (side > 0 && o > 2.9) o = 2.9;
        segs[i].sprites.push({ t, o, sz, w, v: rnd() });
        if (t === "palm" && rnd() < 0.5) {
          segs[i + 1].sprites.push({
            t,
            o: o + side * 0.5,
            sz: 2800,
            w: 0.28,
            v: rnd(),
          });
        }
        if (rnd() < 0.6) {
          segs[i + 2].sprites.push({
            t: "palm",
            o: -side * (2.6 + rnd() * 2),
            sz: 3000 + rnd() * 600,
            w: 0,
            v: rnd(),
          });
        }
      }

      for (let i = 70; i < N - 30; i += 95 + Math.floor(rnd() * 40)) {
        for (let k = 0; k < 6; k++) segs[i + k].boost = true;
      }

      for (let i = 45; i < N - 40; i += 70 + Math.floor(rnd() * 30)) {
        const o = (rnd() - 0.5) * 1.4;
        for (let k = 0; k < 8; k++) {
          segs[i + k * 2].sprites.push({
            t: "coin",
            o: o + Math.sin(k * 0.8) * 0.25,
            sz: 300,
            w: 0,
            v: rnd(),
          });
        }
      }
    }

    let P: any = {
      tot: playerZ,
      x: 0,
      speed: 0,
      boost: 65,
      hp: 100,
      inv: 0,
      coins: 0,
      pad: 0,
      boosting: false,
      drifting: false,
      driftCharge: 0,
      driftBoostTimer: 0,
      drafting: false,
      cameraBankRad: 0,
      shockwaveAge: 99,
      st: 0,
      lastPad: -1,
      fin: false,
      time: 0,
      lastLapReported: 1,
    };
    let cars: any[] = [];
    let st: "menu" | "count" | "race" | "finish" | "over" = "menu";
    let cd = 3;
    let lastN = 0;
    let time = 0;
    let bgX = 0;
    let parts: any[] = [];
    let shake = 0;
    let gt = 0;
    let lastSyncTs = 0;

    function placeCar(c: any) {
      const s = segs[Math.floor((c.tot % trackLen) / segL)];
      if (c.seg !== s) {
        if (c.seg) {
          const idx = c.seg.cars.indexOf(c);
          if (idx >= 0) c.seg.cars.splice(idx, 1);
        }
        if (s) {
          s.cars.push(c);
          c.seg = s;
        }
      }
    }

    const findSeg = (z: number) =>
      segs[Math.floor((((z % trackLen) + trackLen) % trackLen) / segL) % N];

    function resetRace() {
      const currentSave = saveRef.current;
      buildTrack(currentSave.track);
      P = {
        tot: playerZ,
        x: 0,
        speed: 0,
        boost: 70,
        hp: 100,
        inv: 0,
        coins: 0,
        pad: 0,
        boosting: false,
        drifting: false,
        driftCharge: 0,
        driftBoostTimer: 0,
        drafting: false,
        cameraBankRad: 0,
        shockwaveAge: 99,
        st: 0,
        lastPad: -1,
        fin: false,
        time: 0,
        lastLapReported: 1,
      };
      const aiPaceBoost = Math.min(0.08, (playerLevel - 1) * 0.01);
      cars = RIVAL_DRIVERS.map((c, i) => ({
        col: c.col,
        name: c.name,
        tot: playerZ + segL * (2 + Math.floor(i / 2) * 3),
        off: i % 2 ? 0.5 : -0.5,
        base: i % 2 ? 0.5 : -0.5,
        spd: 0,
        top: MAX * (0.79 + aiPaceBoost + i * 0.027),
        ph: i * 2,
        fin: false,
        seg: null,
      }));
      cars.forEach(placeCar);
      st = "count";
      cd = 3.99;
      lastN = 0;
      parts = [];
      time = 0;
      setEndSummary(null);
      setUiScreen("racing");
    }

    startRaceFnRef.current = () => {
      ensureAudioStarted();
      resetRace();
    };

    buildTrack(saveRef.current.track);

    function getRank() {
      let r = 1;
      for (const c of cars) if (c.tot > P.tot) r++;
      return r;
    }

    function syncProgressToArena(
      force = false,
      finished = false,
      wrecked = false
    ) {
      const now = performance.now();
      if (!force && now - lastSyncTs < 1200) return;
      lastSyncTs = now;
      if (!onStateChangeRef.current) return;

      const prog = clamp((P.tot - playerZ) / (LAPS * trackLen), 0, 1);
      const r = getRank();
      const prev = initialStateRef.current || INITIAL_BUGGY_STATE;
      const nextState: BuggyRaceBoardState = {
        trackId: saveRef.current.track,
        laps: LAPS,
        creatorProgress: mySide === "creator" ? prog : prev.creatorProgress || 0,
        opponentProgress:
          mySide === "opponent" ? prog : prev.opponentProgress || 0,
        creatorTime:
          mySide === "creator"
            ? Number(P.time.toFixed(2))
            : prev.creatorTime || 0,
        opponentTime:
          mySide === "opponent"
            ? Number(P.time.toFixed(2))
            : prev.opponentTime || 0,
        creatorRank: mySide === "creator" ? r : prev.creatorRank || 2,
        opponentRank: mySide === "opponent" ? r : prev.opponentRank || 2,
        creatorFinished:
          mySide === "creator" ? finished : Boolean(prev.creatorFinished),
        opponentFinished:
          mySide === "opponent" ? finished : Boolean(prev.opponentFinished),
        creatorWrecked:
          mySide === "creator" ? wrecked : Boolean(prev.creatorWrecked),
        opponentWrecked:
          mySide === "opponent" ? wrecked : Boolean(prev.opponentWrecked),
        moveCount: Number(prev.moveCount || 0) + 1,
        winner: prev.winner || null,
      };
      onStateChangeRef.current(nextState);
    }

    function handleDamage(dmg: number) {
      if (P.inv > 0 || st !== "race") return;
      const veh =
        GHANA_VEHICLES.find((v) => v.id === saveRef.current.vehicle) ||
        GHANA_VEHICLES[0];
      const armorFactor =
        (1 - saveRef.current.up.arm * 0.12) / veh.armorBonus;
      P.hp = Math.max(0, P.hp - dmg * armorFactor);
      P.inv = 1.2;
      triggerHapticSensor("bomb");
      if (P.hp <= 0) {
        triggerGameOver();
      }
    }

    const RACE_CUTOFF_SECONDS = 95;

    function triggerGameOver(timedOut = false) {
      st = "over";
      P.boosting = false;
      shake = 1;
      playBeep(60, 0.9, 0.2);
      for (let i = 0; i < 40; i++) {
        parts.push({
          x: W / 2 + (Math.random() - 0.5) * 160,
          y: H * 0.82,
          vx: (Math.random() - 0.5) * 160,
          vy: -60 - Math.random() * 120,
          l: 1.6,
          m: 1.6,
          r: 10 + Math.random() * 14,
          c: i % 3 ? "50,50,50" : "255,140,30",
          a: 0.8,
        });
      }
      const lap = Math.min(LAPS, Math.floor((P.tot - playerZ) / trackLen) + 1);
      const cVal = P.coins * 15;
      const nextSave: SuameSaveData = {
        ...saveRef.current,
        bank: saveRef.current.bank + cVal,
      };
      persistSave(nextSave);
      syncProgressToArena(true, false, true);

      window.setTimeout(() => {
        setEndSummary({
          won: false,
          wrecked: !timedOut,
          timedOut,
          rank: 6,
          lap,
          raceTime: P.time,
          prizeCoins: 0,
          collectedCoins: cVal,
          newBest: false,
        });
        setUiScreen("end");
        if (onMatchCompleteRef.current) {
          const otherSide = mySide === "creator" ? "opponent" : "creator";
          onMatchCompleteRef.current(otherSide);
        }
      }, 1200);
    }

    function triggerFinishRace(r: number) {
      const prizes = [0, 1000, 600, 400, 250, 150, 100];
      const prize = prizes[r] || 100;
      const cVal = P.coins * 15;
      const curSave = saveRef.current;
      const isNewBest = P.time < (curSave.best || 1e9);
      const nextSave: SuameSaveData = {
        ...curSave,
        bank: curSave.bank + prize + cVal,
        best: isNewBest ? P.time : curSave.best,
      };
      persistSave(nextSave);
      syncProgressToArena(true, true, false);

      if (r <= 2 && P.time <= RACE_CUTOFF_SECONDS) {
        playLevelUpFanfare();
        triggerHapticSensor("win");
        onPointsEarnedRef.current?.(
          r === 1 ? 35 : 15,
          r === 1
            ? "🏆 1st Place Timed Labadi Buggy GP Finish (+35 pts)!"
            : "🥈 2nd Place Timed Podium Finish (+15 pts)!"
        );
      }

      window.setTimeout(() => {
        setEndSummary({
          won: r === 1,
          wrecked: false,
          timedOut: false,
          rank: r,
          lap: LAPS,
          raceTime: P.time,
          prizeCoins: prize,
          collectedCoins: cVal,
          newBest: isNewBest,
        });
        setUiScreen("end");
        if (onMatchCompleteRef.current) {
          const otherSide = mySide === "creator" ? "opponent" : "creator";
          onMatchCompleteRef.current(r <= 2 ? mySide : otherSide);
        }
      }, 1400);
    }

    function update(dt: number) {
      time += dt;
      gt += dt;
      const keys = keysRef.current;
      const curSave = saveRef.current;
      const veh =
        GHANA_VEHICLES.find((v) => v.id === curSave.vehicle) ||
        GHANA_VEHICLES[0];

      if (st === "count") {
        cd -= dt;
        const n = Math.floor(cd);
        if (n !== lastN) {
          lastN = n;
          playBeep(n > 0 ? 440 : 880, n > 0 ? 0.15 : 0.5);
          triggerHapticSensor("tap");
        }
        if (cd < 1) {
          st = "race";
          P.time = 0;
        }
      }
      if (st === "menu") return;

      const ps = findSeg(P.tot);
      const sp = P.speed / MAX;
      const racing = st === "race";
      const auto = st === "finish";
      if (P.inv > 0) P.inv -= dt;
      if (P.shockwaveAge < 1.5) P.shockwaveAge += dt * 2.2;

      if (racing) {
        const keySteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const tg =
          Math.abs(steerAxisRef.current) > 0.03
            ? steerAxisRef.current
            : keySteer;

        // Power-Slide Drift Physics: holding Brake/Drift + Steering above 45% speed
        const wantsDrift = Boolean(
          keys.down && Math.abs(tg) > 0.22 && P.speed > MAX * 0.42
        );
        if (wantsDrift) {
          P.drifting = true;
          P.driftCharge = Math.min(100, P.driftCharge + dt * 58);
          P.boost = Math.min(100, P.boost + dt * 14);
          if (ps.skidmarks && ps.skidmarks.length < 3) {
            ps.skidmarks.push(P.x);
          }
        } else {
          if (P.drifting && P.driftCharge >= 45) {
            P.driftBoostTimer = P.driftCharge >= 85 ? 1.5 : 0.9;
            P.shockwaveAge = 0;
            playBeep(1080, 0.2, 0.1);
            triggerHapticSensor("capture");
          }
          P.drifting = false;
          P.driftCharge = Math.max(0, P.driftCharge - dt * 80);
        }

        if (P.driftBoostTimer > 0) P.driftBoostTimer -= dt;

        // Slipstream Drafting behind rival buggies within 45m
        let isDraftingNow = false;
        for (const c of cars) {
          const distAhead = c.tot - P.tot;
          if (
            distAhead > segL * 0.8 &&
            distAhead < segL * 7.5 &&
            Math.abs(P.x - c.off) < 0.36 &&
            P.speed > MAX * 0.5
          ) {
            isDraftingNow = true;
            break;
          }
        }
        P.drafting = isDraftingNow;
        if (isDraftingNow) {
          P.boost = Math.min(100, P.boost + dt * 6);
        }

        const bo = Boolean(keys.boost && P.boost > 0 && P.speed > MAX * 0.22);
        const wasBoosting = P.boosting;
        P.boosting = bo || P.pad > 0 || P.driftBoostTimer > 0;
        if (P.boosting && !wasBoosting) {
          P.shockwaveAge = 0;
        }

        if (bo) {
          P.boost = Math.max(
            0,
            P.boost - 24 * (1 - curSave.up.nit * 0.1) * dt
          );
        } else {
          P.boost = Math.min(
            100,
            P.boost + (3.2 + curSave.up.nit * 0.9) * dt
          );
        }
        if (P.pad > 0) P.pad -= dt;
        P.time += dt;

        // Enforce 95-second 3-Lap Race Cutoff Timer
        if (P.time >= RACE_CUTOFF_SECONDS) {
          triggerGameOver(true);
          return;
        }

        const up = Boolean(keys.up || (autoGasRef.current && (!keys.down || P.drifting)));
        const draftBonus = P.drafting ? 1.11 : 1.0;
        const cap =
          MAX *
          veh.speedBonus *
          (1 + curSave.up.eng * 0.045) *
          (P.boosting ? 1.34 : 1) *
          draftBonus *
          (P.drifting ? 0.94 : 1);

        if (up) {
          P.speed +=
            ACC *
            veh.speedBonus *
            (1 + curSave.up.eng * 0.08) *
            (P.boosting ? 2.45 : 1) *
            draftBonus *
            dt;
        } else if (keys.down && !P.drifting) {
          P.speed -= BRK * dt;
        } else {
          P.speed -= DEC * dt;
        }

        if (P.speed > cap) P.speed = Math.max(cap, P.speed - MAX * 0.6 * dt);

        const driftTurnBonus = P.drifting ? 1.32 : 1.0;
        const dx = dt * 2.55 * veh.steerBonus * sp * driftTurnBonus;
        P.x += tg * dx;
        P.st += (tg - P.st) * Math.min(1, dt * 10);
        // Drift counter-acts centrifugal pull so player can carve hairpins!
        const centFactor = P.drifting ? CENT * 0.58 : CENT;
        P.x -= dx * sp * ps.curve * centFactor;

        // Smooth camera horizon roll banking
        const targetBank = clamp(
          (-P.st * 0.055 - ps.curve * 0.0045) * sp,
          -0.085,
          0.085
        );
        P.cameraBankRad += (targetBank - P.cameraBankRad) * Math.min(1, dt * 8);

        if (
          Math.abs(P.x) > 1.05 &&
          P.speed > OFFLIM &&
          veh.id !== "kantanka"
        ) {
          P.speed -= OFFDEC * dt;
          shake = Math.max(shake, 0.25);
        }
        if (P.x > 3.1) {
          P.x = 3.1;
          P.speed *= 0.97;
        }
        if (P.x < -3.1) {
          P.x = -3.1;
          P.speed *= 0.97;
        }
        P.speed = clamp(P.speed, 0, MAX * 1.8);

        if (ps.boost && Math.abs(P.x) < 0.85 && P.lastPad !== ps.i) {
          P.pad = 1.7;
          P.boost = Math.min(100, P.boost + 25);
          P.shockwaveAge = 0;
          P.lastPad = ps.i;
          playBeep(990, 0.25);
          triggerHapticSensor("capture");
        }
        if (!ps.boost) P.lastPad = -1;

        for (const s of ps.sprites) {
          if (
            s.w &&
            Math.abs(P.x - s.o) < 0.2 + s.w * 0.55 &&
            P.speed > MAX * 0.1
          ) {
            P.speed = MAX * 0.14;
            P.x += P.x < s.o ? -0.12 : 0.12;
            shake = 0.6;
            playBeep(90, 0.3, 0.15);
            const dmgMap: Record<string, number> = {
              rock: 24,
              hut: 32,
              palm: 18,
              umb: 14,
            };
            handleDamage(dmgMap[s.t] || 18);
            break;
          }
        }

        for (let k = 0; k < 2; k++) {
          for (const s of segs[(ps.i + k) % N].sprites) {
            if (s.t === "coin" && !s.got && Math.abs(P.x - s.o) < 0.36) {
              s.got = 1;
              P.coins++;
              playBeep(1200 + (P.coins % 8) * 60, 0.08, 0.06);
              if (P.coins % 12 === 0) {
                onPointsEarnedRef.current?.(
                  4,
                  "🪙 Collected 12 Ghana Cedi Track Coins (+4 pts)!"
                );
              }
            }
          }
        }

        for (let k = 0; k < 3; k++) {
          const sg = segs[(ps.i + k) % N];
          for (const c of sg.cars) {
            if (P.speed > c.spd && Math.abs(P.x - c.off) < 0.38) {
              P.speed = c.spd * 0.85;
              P.x += P.x < c.off ? -0.08 : 0.08;
              shake = 0.4;
              playBeep(130, 0.2, 0.12);
              handleDamage(7);
            }
          }
        }

        const currentLap = Math.min(
          LAPS,
          Math.floor((P.tot - playerZ) / trackLen) + 1
        );
        if (currentLap > P.lastLapReported) {
          P.lastLapReported = currentLap;
          playTurnNotificationSound();
          onPointsEarnedRef.current?.(
            5,
            `🏁 Completed Lap ${currentLap - 1} of ${LAPS} (+5 pts)!`
          );
        }

        syncProgressToArena(false, false, false);
      } else if (auto) {
        P.speed = Math.max(MAX * 0.25, P.speed - MAX * 0.1 * dt);
        P.x *= 1 - dt * 1.5;
        P.st *= 0.9;
        P.cameraBankRad *= 0.9;
      } else if (st === "over") {
        P.speed = Math.max(0, P.speed - MAX * 1.2 * dt);
        P.cameraBankRad *= 0.9;
      } else {
        P.speed = 0;
      }

      P.tot += P.speed * dt;
      if (racing && P.tot >= LAPS * trackLen + playerZ && !P.fin) {
        P.fin = true;
        st = "finish";
        const r = getRank();
        triggerFinishRace(r);
      }

      for (const c of cars) {
        if (st === "race" || st === "finish" || st === "over") {
          const d = c.tot - P.tot;
          let t = c.top;
          if (d > trackLen * 0.015) t *= 0.92;
          if (d < -trackLen * 0.02) t *= 1.12;
          if (d < -trackLen * 0.06) t *= 1.18;
          c.spd += clamp(t - c.spd, -MAX * dt, ACC * 0.9 * dt);
          c.off = c.base + Math.sin(time * 0.6 + c.ph) * 0.35;
          c.tot += c.spd * dt;
        }
        placeCar(c);
      }

      bgX += ps.curve * sp * dt * 90;
      shake = Math.max(0, shake - dt * 1.5);

      if (
        P.speed > MAX * 0.1 &&
        (Math.abs(P.x) > 1.05 ||
          P.boosting ||
          P.drifting ||
          Math.random() < 0.16)
      ) {
        const off = Math.abs(P.x) > 1.05;
        for (const sx of [-55, 55]) {
          parts.push({
            x: W / 2 + sx + P.st * 18,
            y: H * 0.91,
            vx: (Math.random() - 0.5) * 65 - sx * 0.5 - P.st * 40,
            vy: -42 - Math.random() * 65,
            l: P.drifting ? 0.85 : 0.7,
            m: P.drifting ? 0.85 : 0.7,
            r: P.drifting ? 8 + Math.random() * 10 : 6 + Math.random() * 8,
            c:
              P.boosting && !off
                ? "56,189,248"
                : P.drifting
                ? P.driftCharge >= 80
                  ? "56,189,248"
                  : "251,146,60"
                : "236,210,160",
            a: P.drifting ? 0.65 : off ? 0.6 : 0.3,
          });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.l -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += dt * 22;
        if (p.l <= 0) parts.splice(i, 1);
      }

      if (
        audioCtxRef.current &&
        engineGainRef.current &&
        engineOscRef.current &&
        engineFilterRef.current
      ) {
        engineGainRef.current.gain.value =
          st === "menu" || mutedRef.current ? 0 : 0.04 + sp * 0.028;
        engineOscRef.current.frequency.value =
          55 + sp * 175 + (P.boosting ? 42 : 0) + (P.drifting ? 18 : 0);
        engineFilterRef.current.frequency.value = 300 + sp * 950;
      }
    }

    function poly(
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
      g: number,
      h: number,
      col: string
    ) {
      ctx!.fillStyle = col;
      ctx!.beginPath();
      ctx!.moveTo(a, b);
      ctx!.lineTo(c, d);
      ctx!.lineTo(e, f);
      ctx!.lineTo(g, h);
      ctx!.closePath();
      ctx!.fill();
    }

    function project(p: any, cx: number, cy: number, cz: number) {
      const c = p.camera;
      const s = p.screen;
      c.x = -cx;
      c.y = (p.world.y || 0) - cy;
      c.z = p.world.z - cz;
      s.sc = camD / c.z;
      s.x = Math.round(W / 2 + (s.sc * c.x * W) / 2);
      s.y = Math.round(HY - (s.sc * c.y * H) / 2);
      s.w = Math.round((s.sc * roadW * W) / 2);
    }

    function drawBackground() {
      const trk =
        GHANA_TRACKS.find((t) => t.id === saveRef.current.track) ||
        GHANA_TRACKS[0];
      let g = ctx!.createLinearGradient(0, -40, 0, HY + 30);
      g.addColorStop(0, trk.skyTop);
      g.addColorStop(0.68, trk.skyMid);
      g.addColorStop(1, trk.skyBot);
      ctx!.fillStyle = g;
      ctx!.fillRect(-80, -60, W + 160, HY + 90);

      // Sun & Volumetric Lens Flare Rings
      const sx = W * 0.72 - ((bgX * 0.03) % W);
      const sy = HY * 0.46;
      const sunGlow = ctx!.createRadialGradient(sx, sy, 8, sx, sy, 130);
      sunGlow.addColorStop(0, "rgba(255,252,220,0.95)");
      sunGlow.addColorStop(0.35, "rgba(255,215,110,0.45)");
      sunGlow.addColorStop(1, "rgba(255,180,60,0)");
      ctx!.fillStyle = sunGlow;
      ctx!.beginPath();
      ctx!.arc(sx, sy, 130, 0, Math.PI * 2);
      ctx!.fill();

      // Subtle Diagonal Sun Lens Flare Hex Circles
      const flareDx = W / 2 - sx;
      const flareDy = HY * 0.85 - sy;
      [0.35, 0.65, 0.95, 1.25].forEach((t, idx) => {
        ctx!.fillStyle =
          idx % 2 === 0
            ? "rgba(255, 230, 140, 0.09)"
            : "rgba(56, 189, 248, 0.08)";
        ctx!.beginPath();
        ctx!.arc(
          sx + flareDx * t,
          sy + flareDy * t,
          14 + idx * 9,
          0,
          Math.PI * 2
        );
        ctx!.fill();
      });

      ctx!.fillStyle = "rgba(255,255,255,.82)";
      for (let i = 0; i < 6; i++) {
        const cx =
          ((((i * 260 + gt * 6 - bgX * 0.1) % (W + 340)) + (W + 340)) %
            (W + 340)) -
          170;
        const cy = 42 + ((i * 28) % 100);
        for (let k = 0; k < 4; k++) {
          ctx!.beginPath();
          ctx!.ellipse(
            cx + k * 34,
            cy + (k % 2) * -8,
            42,
            16 + (k % 2) * 6,
            0,
            0,
            7
          );
          ctx!.fill();
        }
      }

      const P0 = 1920;
      (
        [
          [trk.hill1, 0.12, 48, 22],
          [trk.hill2, 0.25, 34, 14],
        ] as [string, number, number, number][]
      ).forEach(([c, f, a, b], j) => {
        ctx!.fillStyle = c;
        ctx!.beginPath();
        ctx!.moveTo(-60, HY + 20);
        for (let x = -60; x <= W + 60; x += 10) {
          const u = ((x + bgX * f * 10) * 2 * Math.PI) / P0;
          const y =
            HY -
            14 -
            Math.abs(Math.sin(u * (1 + j))) * a -
            Math.abs(Math.sin(u * 3.3 + j)) * b * 0.5;
          ctx!.lineTo(x, y);
        }
        ctx!.lineTo(W + 60, HY + 20);
        ctx!.fill();
      });

      g = ctx!.createLinearGradient(0, HY - 18, 0, HY + 6);
      g.addColorStop(0, trk.waterLight);
      g.addColorStop(1, trk.waterDark);
      ctx!.fillStyle = g;
      ctx!.fillRect(-60, HY - 18, W + 120, 24);
      ctx!.fillStyle = "rgba(255,255,255,.65)";
      for (let i = 0; i < 30; i++) {
        ctx!.fillRect(
          (i * 97 + gt * 16) % W,
          HY - 16 + ((i * 7) % 14),
          12 + (i % 3) * 6,
          1.6
        );
      }
    }

    function drawSegment(s: any, n: number) {
      const trk =
        GHANA_TRACKS.find((t) => t.id === saveRef.current.track) ||
        GHANA_TRACKS[0];
      const a = s.p1.screen;
      const b = s.p2.screen;
      const L = s.light;
      const f = Math.pow(n / drawN, 2.4) * 0.85;

      ctx!.fillStyle = L ? trk.groundLight : trk.groundDark;
      ctx!.fillRect(-80, b.y, W + 160, a.y - b.y + 2);

      poly(
        a.x + a.w * 2.5,
        a.y,
        a.x + a.w * 3.15,
        a.y,
        b.x + b.w * 3.15,
        b.y,
        b.x + b.w * 2.5,
        b.y,
        L ? trk.shoulderLight : trk.shoulderDark
      );
      poly(
        a.x + a.w * 3.15,
        a.y,
        W + 260,
        a.y,
        W + 260,
        b.y,
        b.x + b.w * 3.15,
        b.y,
        L ? trk.waterLight : trk.waterDark
      );
      // Animated Ocean Surf Foam on right shore
      const waveShift = Math.sin(gt * 3.2 + s.i * 0.18) * 0.12;
      poly(
        a.x + a.w * (3.08 + waveShift),
        a.y,
        a.x + a.w * (3.32 + waveShift),
        a.y,
        b.x + b.w * (3.32 + waveShift),
        b.y,
        b.x + b.w * (3.08 + waveShift),
        b.y,
        "rgba(255,255,255,.78)"
      );
      poly(
        a.x - a.w * 3.15,
        a.y,
        a.x - a.w * 2.5,
        a.y,
        b.x - b.w * 2.5,
        b.y,
        b.x - b.w * 3.15,
        b.y,
        L ? trk.shoulderLight : trk.shoulderDark
      );

      const r1 = a.w / 7;
      const r2 = b.w / 7;
      const curbPalette = ["#dc2626", "#facc15", "#16a34a"];
      const rc = curbPalette[Math.floor(s.i / 3) % 3];
      poly(
        a.x - a.w - r1,
        a.y,
        a.x - a.w,
        a.y,
        b.x - b.w,
        b.y,
        b.x - b.w - r2,
        b.y,
        rc
      );
      poly(
        a.x + a.w + r1,
        a.y,
        a.x + a.w,
        a.y,
        b.x + b.w,
        b.y,
        b.x + b.w + r2,
        b.y,
        rc
      );

      poly(
        a.x - a.w,
        a.y,
        a.x + a.w,
        a.y,
        b.x + b.w,
        b.y,
        b.x - b.w,
        b.y,
        L ? trk.roadLight : trk.roadDark
      );

      // Persistent Drift Tire Skidmarks on Road
      if (s.skidmarks && s.skidmarks.length > 0) {
        for (const skX of s.skidmarks) {
          for (const wheelOff of [-0.14, 0.14]) {
            const ox1 = a.x + (skX + wheelOff) * a.w;
            const ox2 = b.x + (skX + wheelOff) * b.w;
            const kw1 = Math.max(1.5, a.w * 0.025);
            const kw2 = Math.max(1.5, b.w * 0.025);
            poly(
              ox1 - kw1,
              a.y,
              ox1 + kw1,
              a.y,
              ox2 + kw2,
              b.y,
              ox2 - kw2,
              b.y,
              "rgba(15, 23, 42, 0.55)"
            );
          }
        }
      }

      if (s.boost) {
        const pulse = 0.65 + ((Math.floor(gt * 10) + s.i) % 2 ? 0.3 : 0);
        poly(
          a.x - a.w * 0.58,
          a.y,
          a.x + a.w * 0.58,
          a.y,
          b.x + b.w * 0.58,
          b.y,
          b.x - b.w * 0.58,
          b.y,
          `rgba(250, 204, 21, ${pulse})`
        );
        poly(
          a.x - a.w * 0.32,
          a.y,
          a.x + a.w * 0.32,
          a.y,
          b.x + b.w * 0.32,
          b.y,
          b.x - b.w * 0.32,
          b.y,
          `rgba(56, 189, 248, ${pulse * 0.85})`
        );
      } else if (L) {
        const l1 = a.w / 32;
        const l2 = b.w / 32;
        const w1 = (a.w * 2) / lanes;
        const w2 = (b.w * 2) / lanes;
        let x1 = a.x - a.w + w1;
        let x2 = b.x - b.w + w2;
        for (let i = 1; i < lanes; i++, x1 += w1, x2 += w2) {
          poly(
            x1 - l1 / 2,
            a.y,
            x1 + l1 / 2,
            a.y,
            x2 + l2 / 2,
            b.y,
            x2 - l2 / 2,
            b.y,
            "#e2e8f0"
          );
        }
      }

      if (f > 0.01) {
        ctx!.fillStyle = `rgba(${trk.fogRgb},${f})`;
        ctx!.fillRect(-80, b.y, W + 160, a.y - b.y + 1);
      }
    }

    function drawPalm(x: number, y: number, h: number, v: number) {
      const lean = (v - 0.5) * h * 0.25;
      ctx!.strokeStyle = "#7a5230";
      ctx!.lineWidth = Math.max(2, h * 0.05);
      ctx!.lineCap = "round";
      ctx!.beginPath();
      ctx!.moveTo(x, y);
      ctx!.quadraticCurveTo(x + lean * 0.2, y - h * 0.5, x + lean, y - h);
      ctx!.stroke();
      ctx!.strokeStyle = "#5a3a1e";
      ctx!.lineWidth = Math.max(1, h * 0.012);
      for (let i = 1; i < 7; i++) {
        const t = i / 7;
        ctx!.beginPath();
        ctx!.moveTo(x + lean * t * t * 0.8 - h * 0.03, y - h * t);
        ctx!.lineTo(x + lean * t * t * 0.8 + h * 0.03, y - h * t);
        ctx!.stroke();
      }
      const tx = x + lean;
      const ty = y - h;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + v;
        const L = h * 0.42;
        const ex = tx + Math.cos(a) * L;
        const ey = ty + Math.sin(a) * L * 0.5 + L * 0.35;
        ctx!.strokeStyle = i % 2 ? "#2f9a3e" : "#44b84f";
        ctx!.lineWidth = Math.max(2, h * 0.055);
        ctx!.beginPath();
        ctx!.moveTo(tx, ty);
        ctx!.quadraticCurveTo(
          tx + Math.cos(a) * L * 0.55,
          ty - L * 0.35 + Math.sin(a) * L * 0.2,
          ex,
          ey
        );
        ctx!.stroke();
      }
      ctx!.fillStyle = "#5b3a1a";
      ctx!.beginPath();
      ctx!.arc(tx - h * 0.02, ty + h * 0.03, h * 0.03, 0, 7);
      ctx!.arc(tx + h * 0.03, ty + h * 0.04, h * 0.03, 0, 7);
      ctx!.fill();
    }

    function drawUmbrella(x: number, y: number, h: number, v: number) {
      const r = h * 0.38;
      const cy = y - h * 0.85;
      ctx!.fillStyle = "#fff";
      ctx!.fillRect(x - h * 0.012, cy, h * 0.024, h * 0.85);
      ctx!.fillStyle = "rgba(30,30,30,.2)";
      ctx!.beginPath();
      ctx!.ellipse(x + r * 0.3, y, r * 0.8, h * 0.04, 0, 0, 7);
      ctx!.fill();
      const cols = ["#dc2626", "#facc15", "#16a34a"];
      for (let i = 0; i < 6; i++) {
        ctx!.fillStyle = cols[i % 3];
        ctx!.beginPath();
        ctx!.moveTo(x, cy - r * 0.45);
        ctx!.arc(
          x,
          cy,
          r,
          Math.PI + (i * Math.PI) / 6,
          Math.PI + ((i + 1) * Math.PI) / 6
        );
        ctx!.closePath();
        ctx!.fill();
      }
      ctx!.fillStyle = ["#2ab0ff", "#ff9ad5", "#ffe04a"][Math.floor(v * 3)];
      ctx!.fillRect(x + r * 0.7, y - h * 0.06, r * 0.9, h * 0.05);
    }

    function drawRock(x: number, y: number, h: number) {
      ctx!.fillStyle = "#6d6a68";
      ctx!.beginPath();
      ctx!.moveTo(x - h * 0.7, y);
      ctx!.lineTo(x - h * 0.5, y - h * 0.6);
      ctx!.lineTo(x - h * 0.1, y - h);
      ctx!.lineTo(x + h * 0.4, y - h * 0.7);
      ctx!.lineTo(x + h * 0.75, y);
      ctx!.closePath();
      ctx!.fill();
      ctx!.fillStyle = "#8d8a87";
      ctx!.beginPath();
      ctx!.moveTo(x - h * 0.5, y - h * 0.6);
      ctx!.lineTo(x - h * 0.1, y - h);
      ctx!.lineTo(x + h * 0.1, y - h * 0.5);
      ctx!.lineTo(x - h * 0.25, y - h * 0.2);
      ctx!.closePath();
      ctx!.fill();
    }

    function drawHut(x: number, y: number, h: number) {
      const w = h * 0.9;
      ctx!.fillStyle = "#b67d45";
      ctx!.fillRect(x - w * 0.4, y - h * 0.45, w * 0.8, h * 0.45);
      ctx!.fillStyle = "#8c5a2b";
      for (let i = 0; i < 5; i++) {
        ctx!.fillRect(
          x - w * 0.4 + i * w * 0.16 + w * 0.01,
          y - h * 0.45,
          w * 0.02,
          h * 0.45
        );
      }
      ctx!.fillStyle = "#2b1a0e";
      ctx!.fillRect(x - w * 0.1, y - h * 0.3, w * 0.2, h * 0.3);
      ctx!.fillStyle = "#d9b45a";
      ctx!.beginPath();
      ctx!.moveTo(x - w * 0.62, y - h * 0.4);
      ctx!.lineTo(x, y - h);
      ctx!.lineTo(x + w * 0.62, y - h * 0.4);
      ctx!.closePath();
      ctx!.fill();
    }

    function drawCoin(x: number, y: number, h: number, v: number) {
      const a = Math.max(0.12, Math.abs(Math.cos(gt * 6 + v * 6)));
      const r = h * 0.45;
      const cy = y - r * 1.6;
      ctx!.fillStyle = "#b8860b";
      ctx!.beginPath();
      ctx!.ellipse(x, cy, r * a, r, 0, 0, 7);
      ctx!.fill();
      ctx!.fillStyle = "#ffd23a";
      ctx!.beginPath();
      ctx!.ellipse(x, cy, r * a * 0.78, r * 0.8, 0, 0, 7);
      ctx!.fill();
      ctx!.fillStyle = "#fff6a0";
      ctx!.fillRect(x - r * 0.06 * a, cy - r * 0.5, r * 0.12 * a, r * 0.9);
    }

    function drawSign(x: number, y: number, h: number, v: number) {
      const a = GHANA_ADS[Math.floor(v * GHANA_ADS.length) % GHANA_ADS.length];
      const w = h * 1.55;
      const ph = h * 0.5;
      ctx!.fillStyle = "#444";
      ctx!.fillRect(x - w * 0.35, y - h * 0.55, h * 0.05, h * 0.55);
      ctx!.fillRect(x + w * 0.3, y - h * 0.55, h * 0.05, h * 0.55);
      ctx!.fillStyle = "#fff";
      ctx!.fillRect(
        x - w / 2 - h * 0.03,
        y - h - h * 0.03,
        w + h * 0.06,
        ph + h * 0.06
      );
      ctx!.fillStyle = a[1];
      ctx!.fillRect(x - w / 2, y - h, w, ph);
      ctx!.fillStyle = "#fff";
      ctx!.font = "900 " + Math.max(6, h * 0.2) + "px Impact, sans-serif";
      ctx!.textAlign = "center";
      ctx!.fillText(a[0], x, y - h + ph * 0.66);
      ctx!.textAlign = "left";
    }

    const SPRITE_RENDERERS: Record<
      string,
      (x: number, y: number, h: number, v: number) => void
    > = {
      palm: drawPalm,
      umb: drawUmbrella,
      rock: drawRock,
      hut: drawHut,
      coin: drawCoin,
      sign: drawSign,
    };

    function drawBuggy(
      x: number,
      y: number,
      w: number,
      col: string,
      steer: number,
      bounce: number,
      flame: boolean,
      vehicleStyle: GhanaVehicleId = "buggy",
      drifting = false
    ) {
      const u = w / 100;
      ctx!.save();
      ctx!.translate(x, y - bounce);
      if (drifting) {
        ctx!.rotate(steer * 0.14);
      }

      // Ground Contact Shadow + Underglow
      ctx!.fillStyle = flame
        ? "rgba(56, 189, 248, 0.35)"
        : drifting
        ? "rgba(251, 146, 60, 0.32)"
        : "rgba(0,0,0,.38)";
      ctx!.beginPath();
      ctx!.ellipse(0, bounce + u * 2, u * 56, u * 8.5, 0, 0, 7);
      ctx!.fill();

      // Articulated Front Wheels (Turn Left/Right with Steering)
      for (const s of [-1, 1]) {
        ctx!.save();
        ctx!.translate(s * 38 * u, -34 * u);
        ctx!.rotate(clamp(steer * 0.34, -0.42, 0.42));
        ctx!.fillStyle = "#18181b";
        ctx!.beginPath();
        ctx!.roundRect(-8 * u, -12 * u, 16 * u, 24 * u, 4 * u);
        ctx!.fill();
        ctx!.fillStyle = "#f59e0b";
        ctx!.fillRect(s > 0 ? -7 * u : 3 * u, -5 * u, 4 * u, 10 * u);
        ctx!.restore();
      }

      // Wide Rear Racing Slicks with Animated Tread
      for (const s of [-1, 1]) {
        const wx = s * 43 * u;
        ctx!.fillStyle = "#141417";
        ctx!.beginPath();
        ctx!.roundRect(wx - 12 * u, -35 * u, 24 * u, 35 * u, 6 * u);
        ctx!.fill();
        ctx!.fillStyle = "#2b2b30";
        const treadShift = ((gt * 28) % 7) * u;
        for (let i = 0; i < 5; i++) {
          ctx!.fillRect(
            wx - 11 * u,
            -32 * u + i * 7 * u + treadShift * 0.3,
            22 * u,
            2.2 * u
          );
        }
      }

      ctx!.translate(steer * 2.5 * u, 0);
      // Rear Suspension Arms & Transaxle Diffuser
      ctx!.fillStyle = "#27272a";
      ctx!.fillRect(-30 * u, -21 * u, 60 * u, 11 * u);

      // Metallic Multi-Stop Specular Body Shell
      const bodyGrad = ctx!.createLinearGradient(0, -48 * u, 0, -14 * u);
      bodyGrad.addColorStop(0, "#ffffff");
      bodyGrad.addColorStop(0.18, col);
      bodyGrad.addColorStop(0.85, col);
      bodyGrad.addColorStop(1, "#090d16");
      ctx!.fillStyle = bodyGrad;
      ctx!.beginPath();
      ctx!.roundRect(-34 * u, -42 * u, 68 * u, 25 * u, 8 * u);
      ctx!.fill();

      // Ghana Flag Racing Stripe
      ctx!.fillStyle = "#dc2626";
      ctx!.fillRect(-30 * u, -40 * u, 20 * u, 4.2 * u);
      ctx!.fillStyle = "#facc15";
      ctx!.fillRect(-10 * u, -40 * u, 20 * u, 4.2 * u);
      ctx!.fillStyle = "#16a34a";
      ctx!.fillRect(10 * u, -40 * u, 20 * u, 4.2 * u);

      // Exposed Twin-Turbo V8 Intercooler
      ctx!.fillStyle = "#1e293b";
      ctx!.beginPath();
      ctx!.roundRect(-20 * u, -54 * u, 40 * u, 14 * u, 4 * u);
      ctx!.fill();
      ctx!.fillStyle = "#94a3b8";
      for (let i = 0; i < 4; i++) {
        ctx!.fillRect(-16 * u + i * 9 * u, -52 * u, 5 * u, 10 * u);
      }

      if (vehicleStyle === "pragya") {
        ctx!.fillStyle = "#facc15";
        ctx!.beginPath();
        ctx!.roundRect(-27 * u, -86 * u, 54 * u, 11 * u, 5 * u);
        ctx!.fill();
      } else if (vehicleStyle === "trotro") {
        ctx!.fillStyle = col;
        ctx!.beginPath();
        ctx!.roundRect(-30 * u, -84 * u, 60 * u, 32 * u, 6 * u);
        ctx!.fill();
        ctx!.fillStyle = "#0f172a";
        ctx!.fillRect(-25 * u, -78 * u, 50 * u, 15 * u);
      }

      // Chrome Roll Cage
      ctx!.strokeStyle = "#e2e8f0";
      ctx!.lineWidth = 3.2 * u;
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      ctx!.moveTo(-28 * u, -38 * u);
      ctx!.lineTo(-20 * u, -78 * u);
      ctx!.lineTo(20 * u, -78 * u);
      ctx!.lineTo(28 * u, -38 * u);
      ctx!.moveTo(-24 * u, -58 * u);
      ctx!.lineTo(24 * u, -58 * u);
      ctx!.stroke();

      // Carbon-Fiber High-Downforce Rear Wing
      ctx!.fillStyle = "#0f172a";
      ctx!.beginPath();
      ctx!.roundRect(-34 * u, -85 * u, 68 * u, 7 * u, 3 * u);
      ctx!.fill();
      ctx!.fillStyle = "#facc15";
      ctx!.fillRect(-35 * u, -87 * u, 4 * u, 11 * u);
      ctx!.fillRect(31 * u, -87 * u, 4 * u, 11 * u);

      // Driver Helmet (Leans into corners)
      ctx!.save();
      ctx!.translate(steer * 3.5 * u, -68 * u);
      ctx!.rotate(steer * 0.16);
      ctx!.fillStyle = "#f8fafc";
      ctx!.beginPath();
      ctx!.arc(0, 0, 8.5 * u, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.fillStyle = col;
      ctx!.beginPath();
      ctx!.arc(0, -1 * u, 8.5 * u, Math.PI, 0);
      ctx!.fill();
      ctx!.fillStyle = "#0284c7";
      ctx!.fillRect(-7 * u, -2 * u, 14 * u, 4 * u);
      ctx!.restore();

      // Dual Exhaust Pipes + Plasma Nitro / Drift Afterburner Flames
      for (const s of [-1, 1]) {
        ctx!.fillStyle = "#94a3b8";
        ctx!.beginPath();
        ctx!.arc(s * 14 * u, -16 * u, 5.2 * u, 0, 7);
        ctx!.fill();
        ctx!.fillStyle = "#090d16";
        ctx!.beginPath();
        ctx!.arc(s * 14 * u, -16 * u, 3.2 * u, 0, 7);
        ctx!.fill();
        if (flame) {
          // Outer Blue-Gold Supersonic Plasma Cone
          ctx!.fillStyle = "rgba(56, 189, 248, 0.92)";
          ctx!.beginPath();
          ctx!.moveTo(s * 14 * u - 5.5 * u, -14 * u);
          ctx!.lineTo(s * 14 * u, (14 + Math.random() * 18) * u);
          ctx!.lineTo(s * 14 * u + 5.5 * u, -14 * u);
          ctx!.fill();
          // Inner White-Gold Core
          ctx!.fillStyle = "rgba(254, 240, 138, 0.96)";
          ctx!.beginPath();
          ctx!.moveTo(s * 14 * u - 3 * u, -14 * u);
          ctx!.lineTo(s * 14 * u, (7 + Math.random() * 10) * u);
          ctx!.lineTo(s * 14 * u + 3 * u, -14 * u);
          ctx!.fill();
        }
        // LED Tail & Brake Light Bar
        ctx!.fillStyle = keysRef.current.down ? "#ff1744" : "#ef4444";
        ctx!.fillRect(s * 27 * u - 5 * u, -35 * u, 10 * u, 5 * u);
      }
      ctx!.restore();
    }

    function drawPostEffects() {
      const sp = P.speed / MAX;
      const vg = ctx!.createRadialGradient(
        W / 2,
        H / 2,
        H * 0.35,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.75
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,10,30,.52)");

      if (sp > 0.58 || P.boosting || P.drafting) {
        const a = P.boosting ? 0.62 : P.drafting ? 0.45 : (sp - 0.58) * 0.6;
        ctx!.strokeStyle = P.boosting
          ? `rgba(125, 211, 252, ${a * 0.55})`
          : `rgba(255, 255, 255, ${a * 0.45})`;
        ctx!.lineWidth = P.boosting ? 2.4 : 1.8;
        for (let i = 0; i < 38; i++) {
          const rr =
            H * 0.28 +
            (((gt * (P.boosting ? 3.2 : 1.7) + i * 0.137) % 1) * W * 0.55);
          const c = Math.cos(i * 1.9);
          const s = Math.sin(i * 1.9);
          const r2 = rr + 65 + sp * 75;
          ctx!.beginPath();
          ctx!.moveTo(W / 2 + c * rr, HY + s * rr * 0.75);
          ctx!.lineTo(W / 2 + c * r2, HY + s * r2 * 0.75);
          ctx!.stroke();
        }
      }

      // Supersonic Nitro Shockwave Ring around Buggy
      if (P.shockwaveAge < 1.0) {
        const p = P.shockwaveAge;
        ctx!.save();
        ctx!.strokeStyle = `rgba(56, 189, 248, ${(1 - p) * 0.75})`;
        ctx!.lineWidth = (1 - p) * 10;
        ctx!.beginPath();
        ctx!.ellipse(
          W / 2,
          H * 0.84,
          90 + p * 360,
          45 + p * 180,
          0,
          0,
          Math.PI * 2
        );
        ctx!.stroke();
        ctx!.restore();
      }

      if (P.boosting) {
        ctx!.fillStyle = "rgba(56, 189, 248, 0.08)";
        ctx!.fillRect(0, 0, W, H);
      }
      ctx!.fillStyle = vg;
      ctx!.fillRect(0, 0, W, H);
      if (P.inv > 0.8) {
        ctx!.fillStyle = "rgba(255,0,0," + (P.inv - 0.8) * 0.6 + ")";
        ctx!.fillRect(0, 0, W, H);
      }
    }

    function drawPill(x: number, y: number, w: number, h: number) {
      ctx!.fillStyle = "rgba(6, 18, 34, 0.74)";
      ctx!.beginPath();
      ctx!.roundRect(x, y, w, h, 14);
      ctx!.fill();
      ctx!.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx!.lineWidth = 1.5;
      ctx!.stroke();
    }

    function drawHud() {
      const r = getRank();
      const lap = Math.min(LAPS, Math.floor((P.tot - playerZ) / trackLen) + 1);
      const topY = 40; // Leaves top 36px for floating interactive control bar

      // 1. Top-Left Telemetry Card: Position & Coins
      ctx!.textAlign = "left";
      drawPill(12, topY, 142, 54);
      ctx!.fillStyle = "#94a3b8";
      ctx!.font = "800 10px Trebuchet MS, sans-serif";
      ctx!.fillText("POS", 22, topY + 15);
      ctx!.font = "900 30px Impact, sans-serif";
      ctx!.fillStyle = r === 1 ? "#fde047" : "#38bdf8";
      ctx!.fillText(
        ["", "1ST", "2ND", "3RD", "4TH", "5TH", "6TH"][r] || `${r}TH`,
        22,
        topY + 45
      );
      ctx!.font = "800 12px Impact, sans-serif";
      ctx!.fillStyle = "#ffd23a";
      ctx!.fillText(`🪙 ₵${P.coins * 15}`, 88, topY + 20);
      ctx!.fillStyle = "#e2e8f0";
      ctx!.fillText(`${r} / 6`, 94, topY + 42);

      // 2. Top-Right Telemetry Card: Lap & 95s Countdown Clock
      drawPill(W - 160, topY, 148, 54);
      ctx!.fillStyle = "#94a3b8";
      ctx!.font = "800 10px Trebuchet MS, sans-serif";
      ctx!.fillText("LAP", W - 148, topY + 15);
      ctx!.fillStyle = "#ffffff";
      ctx!.font = "900 26px Impact, sans-serif";
      ctx!.fillText(`${lap}/${LAPS}`, W - 148, topY + 44);

      const remainingSec = Math.max(0, RACE_CUTOFF_SECONDS - P.time);
      ctx!.textAlign = "right";
      ctx!.font = "800 11px Trebuchet MS, sans-serif";
      ctx!.fillStyle = remainingSec <= 15 ? "#ff4d4d" : "#ffd24a";
      ctx!.fillText(`⏱️ ${remainingSec.toFixed(1)}s`, W - 22, topY + 20);
      ctx!.fillStyle = "#cbd5e1";
      ctx!.fillText(`${P.time.toFixed(1)}s`, W - 22, topY + 42);

      // 3. Top-Center Integrated Cockpit Pod: Speedometer + Nitro + Armor + Live Track Radar
      // Positioned at the top so the entire bottom-center road & buggy view is 100% open!
      const centerAvailW = Math.max(240, W - 336);
      const podW = Math.min(460, centerAvailW);
      const podH = 54;
      const podX = Math.round(W / 2 - podW / 2);
      const podY = topY;
      drawPill(podX, podY, podW, podH);

      // Digital Speedometer & Gear on Left of Center Pod
      const kmh = Math.round((P.speed / MAX) * 195);
      const gear = Math.min(6, Math.max(1, Math.ceil(kmh / 34)));
      ctx!.textAlign = "left";
      ctx!.fillStyle = P.boosting ? "#38bdf8" : "#ffffff";
      ctx!.font = "900 28px Impact, sans-serif";
      ctx!.fillText(String(kmh), podX + 12, podY + 32);
      ctx!.font = "800 9px Trebuchet MS, sans-serif";
      ctx!.fillStyle = "#94a3b8";
      ctx!.fillText(`KM/H • G${gear}`, podX + 12, podY + 46);

      // Live Track Radar Bar along Top Half of Center Pod
      const barX = podX + 86;
      const barW = Math.max(130, podW - 98);
      const radarY = podY + 12;
      ctx!.fillStyle = "rgba(255,255,255,0.25)";
      ctx!.fillRect(barX, radarY, barW, 3);

      const prog = (t: number) => clamp((t - playerZ) / (LAPS * trackLen), 0, 1);
      cars.forEach((c) => {
        ctx!.fillStyle = c.col;
        ctx!.beginPath();
        ctx!.arc(barX + barW * prog(c.tot), radarY + 1.5, 4, 0, 7);
        ctx!.fill();
      });

      if (mode === "p2p" && initialStateRef.current) {
        const oppProg =
          mySide === "creator"
            ? Number(initialStateRef.current.opponentProgress || 0)
            : Number(initialStateRef.current.creatorProgress || 0);
        ctx!.fillStyle = "#22d3ee";
        ctx!.beginPath();
        ctx!.arc(barX + barW * clamp(oppProg, 0, 1), radarY + 1.5, 5.5, 0, 7);
        ctx!.fill();
      }

      const myVeh =
        GHANA_VEHICLES.find((v) => v.id === saveRef.current.vehicle) ||
        GHANA_VEHICLES[0];
      ctx!.fillStyle = myVeh.color;
      ctx!.strokeStyle = "#fff";
      ctx!.lineWidth = 1.8;
      ctx!.beginPath();
      ctx!.arc(barX + barW * prog(P.tot), radarY + 1.5, 5.5, 0, 7);
      ctx!.fill();
      ctx!.stroke();

      // Side-by-Side Nitro & Armor Gauges on Bottom Half of Center Pod
      const halfGaugeW = Math.floor((barW - 8) / 2);
      const gaugeY = podY + 29;
      ctx!.fillStyle = "rgba(255,255,255,0.16)";
      ctx!.fillRect(barX, gaugeY, halfGaugeW, 13);
      const nitGrad = ctx!.createLinearGradient(barX, 0, barX + halfGaugeW, 0);
      nitGrad.addColorStop(0, "#38bdf8");
      nitGrad.addColorStop(0.5, "#facc15");
      nitGrad.addColorStop(1, "#ef4444");
      ctx!.fillStyle = nitGrad;
      ctx!.fillRect(
        barX,
        gaugeY,
        (halfGaugeW * clamp(P.boost, 0, 100)) / 100,
        13
      );
      ctx!.fillStyle = "#ffffff";
      ctx!.font = "900 8.5px Trebuchet MS, sans-serif";
      ctx!.fillText("N₂ NITRO", barX + 4, gaugeY + 10);

      const armX = barX + halfGaugeW + 8;
      ctx!.fillStyle = "rgba(255,255,255,0.16)";
      ctx!.fillRect(armX, gaugeY, halfGaugeW, 13);
      ctx!.fillStyle =
        P.hp > 50 ? "#10b981" : P.hp > 25 ? "#f59e0b" : "#ef4444";
      ctx!.fillRect(
        armX,
        gaugeY,
        (halfGaugeW * clamp(P.hp, 0, 100)) / 100,
        13
      );
      ctx!.fillStyle = "#ffffff";
      ctx!.fillText("ARMOR", armX + 4, gaugeY + 10);

      // Active Drift / Slipstream / Nitro Status Banner below Top Pod
      if (P.drifting || P.drafting || P.driftBoostTimer > 0) {
        ctx!.textAlign = "center";
        ctx!.font = "900 14px Impact, sans-serif";
        const statusLabel =
          P.driftBoostTimer > 0
            ? "🔥 DRIFT TURBO BOOST!"
            : P.drifting
            ? `⚡ DRIFT CHARGING ${Math.round(P.driftCharge)}%`
            : "💨 SLIPSTREAM DRAFTING +20 KM/H";
        ctx!.fillStyle =
          P.driftBoostTimer > 0 || P.driftCharge >= 80 ? "#38bdf8" : "#facc15";
        ctx!.fillText(statusLabel, W / 2, topY + 72);
      }
    }

    function render() {
      // Dynamically match the device's landscape aspect ratio on every frame
      if (cv.width !== W || cv.height !== H) {
        W = cv.width || 960;
        H = cv.height || 540;
        HY = Math.floor(H * 0.44);
      }

      const trk =
        GHANA_TRACKS.find((t) => t.id === saveRef.current.track) ||
        GHANA_TRACKS[0];
      const myVeh =
        GHANA_VEHICLES.find((v) => v.id === saveRef.current.vehicle) ||
        GHANA_VEHICLES[0];
      const sh = shake * 6;
      ctx!.save();
      if (sh) {
        ctx!.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
      }

      // Apply Camera Horizon Banking around Screen Center
      ctx!.save();
      if (Math.abs(P.cameraBankRad) > 0.001) {
        ctx!.translate(W / 2, HY);
        ctx!.rotate(P.cameraBankRad);
        ctx!.translate(-W / 2, -HY);
      }

      drawBackground();

      const pos = (((P.tot - playerZ) % trackLen) + trackLen) % trackLen;
      const base = findSeg(pos);
      const bp = (pos % segL) / segL;
      const ps = findSeg(pos + playerZ);
      const pp = ((pos + playerZ) % segL) / segL;
      const py = lerp(ps.p1.world.y, ps.p2.world.y, pp);

      let mx = H + 60;
      let x = 0;
      let dx = -(base.curve * bp);
      for (let n = 0; n < drawN; n++) {
        const s = segs[(base.i + n) % N];
        const lp = s.i < base.i;
        const cz = pos - (lp ? trackLen : 0);
        const px = P.x * roadW;
        project(s.p1, px - x, py + camH, cz);
        project(s.p2, px - x - dx, py + camH, cz);
        x += dx;
        dx += s.curve;
        s.clip = mx;
        if (
          s.p1.camera.z <= camD ||
          s.p2.screen.y >= s.p1.screen.y ||
          s.p2.screen.y >= mx
        )
          continue;
        drawSegment(s, n);
        mx = s.p1.screen.y;
      }

      for (let n = drawN - 1; n > 0; n--) {
        const s = segs[(base.i + n) % N];
        if (s.p1.camera.z <= camD) continue;
        const a = s.p1.screen;
        const f = Math.pow(n / drawN, 2.4) * 0.85;
        for (const sp of s.sprites) {
          if (sp.got) continue;
          const sc = a.sc;
          const sx = a.x + (sc * sp.o * roadW * W) / 2;
          const h = (sc * sp.sz * W) / 2;
          if (sx < -h || sx > W + h || h < 2) continue;
          ctx!.save();
          ctx!.beginPath();
          ctx!.rect(-80, -60, W + 160, s.clip + 60);
          ctx!.clip();
          SPRITE_RENDERERS[sp.t]?.(sx, a.y, h, sp.v);
          if (f > 0.02) {
            ctx!.fillStyle = `rgba(${trk.fogRgb},${f * 0.9})`;
            ctx!.fillRect(sx - h, a.y - h * 1.2, h * 2, h * 1.2);
          }
          ctx!.restore();
        }
        for (const c of s.cars) {
          const pc = ((c.tot % trackLen) % segL) / segL;
          const sc = lerp(s.p1.screen.sc, s.p2.screen.sc, pc);
          const cx =
            lerp(a.x, s.p2.screen.x, pc) + (sc * c.off * roadW * W) / 2;
          const cy = lerp(a.y, s.p2.screen.y, pc);
          const w = (sc * 860 * W) / 2;
          if (w < 3) continue;
          ctx!.save();
          ctx!.beginPath();
          ctx!.rect(-80, -60, W + 160, s.clip + 60);
          ctx!.clip();
          drawBuggy(
            cx,
            cy,
            w,
            c.col,
            Math.sin(time * 2 + c.ph) * 0.5,
            Math.sin(time * 30 + c.ph) * w * 0.01,
            false,
            "buggy",
            false
          );
          if (f > 0.02) {
            ctx!.fillStyle = `rgba(${trk.fogRgb},${f * 0.9})`;
            ctx!.fillRect(cx - w * 0.6, cy - w * 0.9, w * 1.2, w * 0.9);
          }
          ctx!.restore();
        }
      }

      ctx!.restore(); // End Camera Horizon Banking

      for (const p of parts) {
        ctx!.fillStyle = "rgba(" + p.c + "," + (p.a * p.l) / p.m + ")";
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, 7);
        ctx!.fill();
      }

      const sp = P.speed / MAX;
      const bn = P.speed > 200 ? Math.sin(time * 42) * sp * 2.4 : 0;
      const playerBuggyY = H * 0.89;
      const playerBuggyW = Math.round(Math.min(192, H * 0.355));
      ctx!.save();
      ctx!.translate(W / 2, playerBuggyY);
      ctx!.rotate(P.st * 0.045 * sp + ps.curve * 0.004 * sp);
      ctx!.translate(-W / 2, -playerBuggyY);
      if (!(P.inv > 0 && Math.floor(time * 14) % 2)) {
        drawBuggy(
          W / 2,
          playerBuggyY,
          playerBuggyW,
          myVeh.color,
          P.st,
          bn,
          P.boosting && st !== "over",
          myVeh.id,
          P.drifting
        );
      }
      ctx!.restore();
      ctx!.restore();

      drawPostEffects();
      drawHud();

      if (st === "count") {
        const n = Math.floor(cd);
        const t = n > 0 ? String(n) : "GO!";
        const k = 1 + (cd % 1) * 0.25;
        ctx!.save();
        ctx!.translate(W / 2, H * 0.38);
        ctx!.scale(k, k);
        ctx!.font = "900 130px Impact, sans-serif";
        ctx!.textAlign = "center";
        ctx!.lineWidth = 10;
        ctx!.strokeStyle = "#6b1d0b";
        ctx!.strokeText(t, 0, 0);
        ctx!.fillStyle = n > 0 ? "#ffd24a" : "#5dff7a";
        ctx!.fillText(t, 0, 0);
        ctx!.restore();
      } else if (st === "race" && P.time < 1.2) {
        ctx!.font = "900 115px Impact, sans-serif";
        ctx!.textAlign = "center";
        ctx!.globalAlpha = 1 - P.time / 1.2;
        ctx!.lineWidth = 9;
        ctx!.strokeStyle = "#1d5a14";
        ctx!.strokeText("GO!", W / 2, H * 0.38);
        ctx!.fillStyle = "#5dff7a";
        ctx!.fillText("GO!", W / 2, H * 0.38);
        ctx!.globalAlpha = 1;
      }
    }

    const km: Record<string, string> = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
      " ": "boost",
      Shift: "boost",
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const k = km[e.key];
      if (k) {
        keysRef.current[k] = 1;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = km[e.key];
      if (k) {
        keysRef.current[k] = 0;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let rafId = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      update(dt);
      render();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ensureAudioStarted, mode, mySide, persistSave, playBeep, playerLevel]);

  const setTouchKey = (
    k: "left" | "right" | "down" | "boost" | "up",
    v: number
  ) => {
    keysRef.current[k] = v;
  };

  // Interactive Steering Wheel Drag Handlers (supports both native landscape & 90deg rotated portrait stage)
  const updateWheelFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = wheelPadRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // In rotated 90deg clockwise portrait stage, screen clientY corresponds to stage horizontal X
      const horizontalDelta = racingMetrics.isRotatedPortrait
        ? clientY - cy
        : clientX - cx;

      const radius = Math.max(34, Math.min(rect.width, rect.height) * 0.44);
      const norm = Math.max(-1, Math.min(1, horizontalDelta / radius));
      steerAxisRef.current = norm;
      setWheelAngleDeg(Math.round(norm * 65));
    },
    [racingMetrics.isRotatedPortrait]
  );

  const handleWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    wheelDraggingRef.current = true;
    updateWheelFromPointer(e.clientX, e.clientY);
  };

  const handleWheelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!wheelDraggingRef.current) return;
    e.preventDefault();
    updateWheelFromPointer(e.clientX, e.clientY);
  };

  const handleWheelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    wheelDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    steerAxisRef.current = 0;
    setWheelAngleDeg(0);
  };

  const handleBuyUpgrade = (key: "eng" | "nit" | "arm") => {
    const curLvl = saveData.up[key];
    const c = upgradeCost(curLvl);
    if (curLvl >= 5 || saveData.bank < c) return;
    ensureAudioStarted();
    playBeep(880, 0.2);
    triggerHapticSensor("win");
    const next: SuameSaveData = {
      ...saveData,
      bank: saveData.bank - c,
      up: {
        ...saveData.up,
        [key]: curLvl + 1,
      },
    };
    persistSave(next);
  };

  const activeTrackMeta =
    GHANA_TRACKS.find((t) => t.id === saveData.track) || GHANA_TRACKS[0];
  const activeVehicleMeta =
    GHANA_VEHICLES.find((v) => v.id === saveData.vehicle) || GHANA_VEHICLES[0];

  const landscapeStageContent = (
    <div className="relative w-full h-full flex-1 min-h-0 overflow-hidden bg-black select-none touch-none">
      {/* 100% Edge-to-Edge Widescreen 3D Canvas Matched to Device Aspect Ratio */}
      <canvas
        ref={canvasRef}
        width={racingMetrics.canvasWidth}
        height={racingMetrics.canvasHeight}
        className="w-full h-full block object-fill"
      />

      {/* Floating Glassmorphic Top Telemetry & Control Bar (Zero Vertical Space Wasted) */}
      <div className="absolute top-1.5 inset-x-2.5 z-30 flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-md border border-white/15 pointer-events-auto">
        <div className="flex items-center gap-1.5 min-w-0">
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-[10px] font-black text-white flex items-center gap-1 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Lobby</span>
            </button>
          )}
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-[10px] font-black text-amber-300 truncate max-w-[140px] sm:max-w-[220px]">
            {activeTrackMeta.badge} {activeTrackMeta.name}
          </span>
          <span className="hidden lg:inline-flex px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-black text-emerald-300">
            🏎️ {activeVehicleMeta.name} • 📱 {racingMetrics.fitSummaryLabel}
          </span>
        </div>

        {/* Live 3-Way Steering Control Selector (Wheel / Motion Tilt / Arrows) */}
        <div className="flex items-center gap-0.5 bg-slate-900/90 p-0.5 rounded-full border border-white/15 shrink-0">
          {(
            [
              { id: "wheel", label: "🛞 Wheel" },
              { id: "tilt", label: "📱 Tilt" },
              { id: "arrows", label: "◀▶ Arrows" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => changeSteeringMode(opt.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-black transition cursor-pointer ${
                steeringMode === opt.id
                  ? "bg-amber-400 text-slate-950 shadow"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-slate-900 border border-white/10 text-[10px] font-black text-amber-300">
            💰 GH₵ {saveData.bank.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setAutoGas((v) => !v)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-black border cursor-pointer ${
              autoGas
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
                : "bg-white/5 text-slate-400 border-white/10"
            }`}
          >
            Gas: {autoGas ? "AUTO" : "MAN"}
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title={muted ? "Unmute Engine Sound" : "Mute Engine Sound"}
          >
            {muted ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            )}
          </button>
          <button
            type="button"
            onClick={toggleFullscreenLandscape}
            className="p-1 rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 cursor-pointer"
            title="Stretch Fullscreen Landscape"
          >
            {screenFit.isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* ── 1. START / TRACK & RIDE MENU OVERLAY ────────────────────────── */}
      {uiScreen === "menu" && (
        <div className="absolute inset-0 z-20 pt-10 pb-2 px-3 sm:px-6 bg-gradient-to-b from-slate-950/85 via-slate-950/90 to-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-evenly text-center overflow-y-auto">
          <div className="space-y-0.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-gradient-to-r from-red-600 via-amber-400 to-emerald-600 text-slate-950 text-[10px] font-black uppercase tracking-wider">
              🇬🇭 Fullscreen Pro Landscape Rally • 📱 {racingMetrics.fitSummaryLabel}
            </div>
            <h1 className="text-xl sm:text-3xl font-black uppercase tracking-tight bg-gradient-to-b from-amber-200 via-amber-400 to-orange-600 bg-clip-text text-transparent drop-shadow">
              Labadi Beach &amp; Aburi Buggy GP
            </h1>
            <p className="text-[11px] text-slate-300 max-w-xl mx-auto">
              3 Laps • 6 Racers ({creatorName} vs {opponentName} &amp; Pack) • Power-Slide Drift + Slipstream + 95s Cutoff!
            </p>
          </div>

          {/* Steering Control Mode Selector in Pre-Race Menu */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-2xl border border-white/15">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 mr-1">
              Steering Control:
            </span>
            {(
              [
                {
                  id: "wheel",
                  label: "🛞 Pro Steering Wheel",
                },
                {
                  id: "tilt",
                  label: "📱 Motion Tilt Sensor",
                },
                {
                  id: "arrows",
                  label: "◀ ▶ Touch Arrows",
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => changeSteeringMode(m.id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition cursor-pointer ${
                  steeringMode === m.id
                    ? "bg-amber-400 text-slate-950 border-amber-300 shadow"
                    : "bg-white/5 text-slate-200 border-white/10 hover:bg-white/10"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Circuit Selector */}
          <div className="w-full max-w-2xl grid grid-cols-3 gap-2 my-0.5">
            {GHANA_TRACKS.map((trk) => {
              const selected = saveData.track === trk.id;
              return (
                <button
                  key={trk.id}
                  type="button"
                  onClick={() => {
                    triggerHapticSensor("tap");
                    persistSave({ ...saveData, track: trk.id });
                  }}
                  className={`p-2 rounded-xl border text-left transition cursor-pointer ${
                    selected
                      ? "bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/40"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-amber-300">
                      {trk.badge}
                    </span>
                    {selected && (
                      <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-400 text-slate-950">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-black text-white mt-0.5 truncate">
                    {trk.name}
                  </p>
                  <p className="text-[9px] text-slate-400 line-clamp-1">
                    {trk.subtitle}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Vehicle Selector */}
          <div className="w-full max-w-2xl grid grid-cols-4 gap-2">
            {GHANA_VEHICLES.map((v) => {
              const selected = saveData.vehicle === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    triggerHapticSensor("tap");
                    persistSave({ ...saveData, vehicle: v.id });
                  }}
                  className={`p-1.5 rounded-xl border text-left transition cursor-pointer ${
                    selected
                      ? "bg-emerald-500/20 border-emerald-400 ring-2 ring-emerald-400/40"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40"
                      style={{ background: v.color }}
                    />
                    <span className="text-[10px] font-black text-white truncate">
                      {v.name}
                    </span>
                  </div>
                  <p className="text-[8px] text-slate-400 line-clamp-1 mt-0.5">
                    {v.tagline}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-0.5">
            <button
              type="button"
              onClick={() => {
                try {
                  (window.screen as any)?.orientation
                    ?.lock?.("landscape")
                    ?.catch?.(() => {});
                } catch {
                  // ignore
                }
                startRaceFnRef.current?.();
              }}
              className="px-6 py-2 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-600 text-slate-950 font-black text-xs sm:text-sm tracking-wider uppercase shadow-xl flex items-center gap-2 hover:scale-105 active:scale-95 transition cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Start 3-Lap Race
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHapticSensor("tap");
                setUiScreen("garage");
              }}
              className="px-4 py-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-700 text-white font-black text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition cursor-pointer"
            >
              <Wrench className="w-4 h-4" />
              Suame Garage (GH₵ {saveData.bank})
            </button>
          </div>
        </div>
      )}

      {/* ── 2. SUAME MAGAZINE MECHANIC GARAGE OVERLAY ───────────────────── */}
      {uiScreen === "garage" && (
        <div className="absolute inset-0 z-20 pt-11 pb-3 px-4 sm:px-6 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between overflow-y-auto">
          <div className="text-center space-y-1">
            <h2 className="text-xl sm:text-2xl font-black uppercase text-amber-400 flex items-center justify-center gap-2">
              <Wrench className="w-5 h-5" />
              Suame Magazine Mechanic Workshop
            </h2>
            <p className="text-xs text-slate-300">
              Workshop Balance:{" "}
              <strong className="text-emerald-400 font-black">
                GH₵ {saveData.bank.toLocaleString()}
              </strong>{" "}
              {saveData.best > 0 && (
                <span>• Best 3-Lap Record: {saveData.best.toFixed(1)}s</span>
              )}
            </p>
          </div>

          <div className="w-full max-w-xl space-y-2 my-1">
            {(["eng", "nit", "arm"] as const).map((k) => {
              const lvl = saveData.up[k];
              const c = upgradeCost(lvl);
              const meta = UPGRADE_META[k];
              const Icon =
                k === "eng" ? Gauge : k === "nit" ? Flame : Shield;
              return (
                <div
                  key={k}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-slate-900 border border-white/15"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white">
                          {meta.title}
                        </span>
                        <span className="text-xs font-mono text-amber-400">
                          {"●".repeat(lvl)}
                          {"○".repeat(5 - lvl)}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {meta.subtitle}
                      </p>
                    </div>
                  </div>

                  {lvl < 5 ? (
                    <button
                      type="button"
                      disabled={saveData.bank < c}
                      onClick={() => handleBuyUpgrade(k)}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-black text-xs shrink-0 cursor-pointer"
                    >
                      GH₵ {c}
                    </button>
                  ) : (
                    <span className="px-3 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-black">
                      MAXED
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setUiScreen("menu")}
              className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-black text-xs uppercase cursor-pointer"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => startRaceFnRef.current?.()}
              className="px-6 py-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs uppercase flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Race Now
            </button>
          </div>
        </div>
      )}

      {/* ── 3. RACE FINISH / GAME OVER SUMMARY OVERLAY ──────────────────── */}
      {uiScreen === "end" && endSummary && (
        <div className="absolute inset-0 z-20 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-5 text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
            {endSummary.wrecked || endSummary.timedOut ? (
              <Flame className="w-7 h-7 text-rose-400" />
            ) : (
              <Trophy className="w-7 h-7 text-amber-300" />
            )}
          </div>

          <h2 className="text-xl sm:text-3xl font-black uppercase text-amber-300">
            {endSummary.timedOut
              ? "⏱️ Time's Up (95s Cutoff)!"
              : endSummary.wrecked
              ? "💥 Buggy Wrecked!"
              : endSummary.rank === 1
              ? "🏆 1st Place Champion!"
              : `🏁 Finished #${endSummary.rank} of 6`}
          </h2>

          <p className="text-xs text-slate-200 max-w-md">
            {endSummary.timedOut
              ? `You reached Lap ${endSummary.lap} of 3 when the 95-second race clock expired. Hit Kente boost pads and upgrade your engine in Suame Garage to beat the clock!`
              : endSummary.wrecked
              ? `Crashed out on Lap ${endSummary.lap} of 3. Upgrade Kantanka Armor in Suame Garage or dodge roadside rocks & coconut palms!`
              : `Completed 3 Laps on ${activeTrackMeta.name} in ${endSummary.raceTime.toFixed(
                  2
                )}s!`}
          </p>

          <div className="px-4 py-2 rounded-2xl bg-slate-900 border border-white/10 text-xs font-bold text-emerald-300 space-y-1">
            <div>
              💰 Race Prize: GH₵ {endSummary.prizeCoins} + Track Coins: GH₵{" "}
              {endSummary.collectedCoins} ={" "}
              <strong className="text-white">
                +GH₵ {endSummary.prizeCoins + endSummary.collectedCoins}
              </strong>
            </div>
            {endSummary.newBest && (
              <div className="text-amber-300 font-black">
                ⚡ NEW TRACK RECORD: {endSummary.raceTime.toFixed(2)}s!
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                startRaceFnRef.current?.();
                onRematch?.();
              }}
              className="px-5 py-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs uppercase flex items-center gap-1.5 shadow-lg cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              🔄 Rematch
            </button>
            {onPlayAnotherGame && (
              <button
                type="button"
                onClick={onPlayAnotherGame}
                className="px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase flex items-center gap-1.5 shadow-lg cursor-pointer"
              >
                🎮 Play Another Game
              </button>
            )}
            <button
              type="button"
              onClick={() => setUiScreen("garage")}
              className="px-4 py-2 rounded-full bg-sky-600 hover:bg-sky-500 text-white font-black text-xs uppercase flex items-center gap-1.5 cursor-pointer"
            >
              <Wrench className="w-4 h-4" />
              Suame Garage
            </button>
          </div>
        </div>
      )}

      {/* ── 4. ON-SCREEN COCKPIT STEERING (WHEEL / TILT / ARROWS) & PEDALS ─ */}
      {uiScreen === "racing" && (
        <div className="absolute inset-x-0 bottom-2 px-3 sm:px-5 flex items-end justify-between pointer-events-none z-20">
          {/* LEFT SIDE: PRO STEERING WHEEL | CALIBRATED MOTION TILT | TOUCH ARROWS */}
          <div className="flex items-center gap-2.5 pointer-events-auto">
            {steeringMode === "wheel" ? (
              <div
                ref={wheelPadRef}
                onPointerDown={handleWheelPointerDown}
                onPointerMove={handleWheelPointerMove}
                onPointerUp={handleWheelPointerUp}
                onPointerCancel={handleWheelPointerUp}
                className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-slate-950/70 border-2 border-amber-400/70 shadow-[0_10px_28px_rgba(0,0,0,0.85)] flex items-center justify-center touch-none cursor-grab active:cursor-grabbing backdrop-blur-sm"
                title="Drag Left or Right to Steer Wheel"
              >
                <svg
                  viewBox="0 0 100 100"
                  className="w-24 h-24 sm:w-28 sm:h-28 transition-transform duration-75"
                  style={{ transform: `rotate(${wheelAngleDeg}deg)` }}
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="12"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="9"
                    strokeDasharray="36 190"
                    strokeDashoffset="-25"
                  />
                  <rect
                    x="46"
                    y="3"
                    width="8"
                    height="11"
                    rx="2"
                    fill="#ef4444"
                  />
                  <line
                    x1="12"
                    y1="48"
                    x2="88"
                    y2="48"
                    stroke="#94a3b8"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                  <line
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="88"
                    stroke="#94a3b8"
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="14"
                    fill="#0f172a"
                    stroke="#fbbf24"
                    strokeWidth="3"
                  />
                  <text
                    x="50"
                    y="54"
                    textAnchor="middle"
                    fill="#fbbf24"
                    fontSize="9"
                    fontWeight="900"
                  >
                    GP
                  </text>
                </svg>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/85 border border-amber-400/50 text-[9px] font-black text-amber-300 whitespace-nowrap">
                  🛞 {wheelAngleDeg > 0 ? `+${wheelAngleDeg}°` : `${wheelAngleDeg}°`}
                </span>
              </div>
            ) : steeringMode === "tilt" ? (
              <div className="p-2.5 rounded-2xl bg-slate-950/85 border border-amber-400/60 backdrop-blur-md space-y-1.5 min-w-[175px] shadow-xl">
                <div className="flex items-center justify-between text-[10px] font-black text-amber-300">
                  <span className="flex items-center gap-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        sensorActive
                          ? "bg-emerald-400 animate-pulse"
                          : "bg-amber-400"
                      }`}
                    />
                    📱 TILT STEER
                  </span>
                  <span>
                    {tiltAngleDeg > 0 ? `+${tiltAngleDeg}°` : `${tiltAngleDeg}°`}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden relative">
                  <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/30" />
                  <div
                    className="absolute top-0 bottom-0 w-3.5 rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all"
                    style={{
                      left: `${Math.max(
                        4,
                        Math.min(90, 50 + (tiltAngleDeg / 32) * 45)
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-1 pt-0.5">
                  <button
                    type="button"
                    onClick={calibrateMotionCenter}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-[9px] font-black text-amber-300 flex items-center gap-1 cursor-pointer"
                    title="Zero out your current phone holding angle as straight center"
                  >
                    <Crosshair className="w-2.5 h-2.5" />
                    Calibrate
                  </button>
                  <button
                    type="button"
                    onClick={cycleTiltSensitivity}
                    className="px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-[9px] font-black text-slate-200 cursor-pointer"
                  >
                    Sens: {tiltSensitivity.toFixed(1)}×
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setTouchKey("left", 1);
                  }}
                  onPointerUp={() => setTouchKey("left", 0)}
                  onPointerCancel={() => setTouchKey("left", 0)}
                  onPointerLeave={() => setTouchKey("left", 0)}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/70 active:bg-amber-400 active:text-slate-950 border-2 border-white/80 text-white font-black text-xl flex items-center justify-center shadow-lg backdrop-blur-sm"
                  aria-label="Steer Left"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setTouchKey("right", 1);
                  }}
                  onPointerUp={() => setTouchKey("right", 0)}
                  onPointerCancel={() => setTouchKey("right", 0)}
                  onPointerLeave={() => setTouchKey("right", 0)}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/70 active:bg-amber-400 active:text-slate-950 border-2 border-white/80 text-white font-black text-xl flex items-center justify-center shadow-lg backdrop-blur-sm"
                  aria-label="Steer Right"
                >
                  ▶
                </button>
              </>
            )}
          </div>

          {/* RIGHT SIDE: GAS, POWER-SLIDE DRIFT/BRAKE & NITRO PEDALS */}
          <div className="flex items-center gap-2.5 pointer-events-auto">
            {!autoGas && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setTouchKey("up", 1);
                }}
                onPointerUp={() => setTouchKey("up", 0)}
                onPointerCancel={() => setTouchKey("up", 0)}
                onPointerLeave={() => setTouchKey("up", 0)}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-600/85 active:bg-emerald-400 border-2 border-white text-white font-black text-xs flex items-center justify-center shadow-lg"
              >
                GAS
              </button>
            )}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                setTouchKey("down", 1);
              }}
              onPointerUp={() => setTouchKey("down", 0)}
              onPointerCancel={() => setTouchKey("down", 0)}
              onPointerLeave={() => setTouchKey("down", 0)}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-slate-950/75 active:bg-orange-500 border-2 border-amber-300/80 text-white font-black flex flex-col items-center justify-center shadow-lg backdrop-blur-sm"
              aria-label="Power-Slide Drift and Brake"
            >
              <span className="text-xs leading-none">💨</span>
              <span className="text-[9px] font-black leading-tight text-amber-300">
                DRIFT
              </span>
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                setTouchKey("boost", 1);
              }}
              onPointerUp={() => setTouchKey("boost", 0)}
              onPointerCancel={() => setTouchKey("boost", 0)}
              onPointerLeave={() => setTouchKey("boost", 0)}
              className="w-15 h-15 sm:w-16 sm:h-16 px-4 py-3.5 rounded-full bg-gradient-to-br from-sky-400 via-amber-400 to-red-600 active:scale-95 border-2 border-white text-slate-950 font-black text-base flex flex-col items-center justify-center shadow-[0_0_24px_rgba(56,189,248,0.65)]"
              aria-label="Nitro Boost"
            >
              <span className="leading-none">🔥</span>
              <span className="text-[11px] font-black leading-none">N₂</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Strict 100% Edge-to-Edge Fullscreen Landscape Stage (both rotated-portrait & native-landscape)
  // Uses fixed center positioning + 100dvh/100dvw + flex-shrink:0 so mobile flexbox NEVER shrinks the landscape breadth into a square!
  if (racingMetrics.isRotatedPortrait) {
    return (
      <div
        ref={stageRootRef}
        className="fixed inset-0 z-[95] bg-black overflow-hidden touch-none overscroll-none select-none m-0 p-0"
      >
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            width: `max(100dvh, ${racingMetrics.stageWidthPx}px)`,
            height: `max(100dvw, ${racingMetrics.stageHeightPx}px)`,
            minWidth: `${racingMetrics.stageWidthPx}px`,
            minHeight: `${racingMetrics.stageHeightPx}px`,
            transform: "translate(-50%, -50%) rotate(90deg)",
            transformOrigin: "center center",
            flexShrink: 0,
          }}
          className="flex flex-col m-0 p-0 overflow-hidden select-none touch-none"
        >
          {landscapeStageContent}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRootRef}
      style={{
        position: "fixed",
        inset: 0,
        width: `max(100dvw, ${racingMetrics.stageWidthPx}px)`,
        height: `max(100dvh, ${racingMetrics.stageHeightPx}px)`,
      }}
      className="fixed inset-0 z-[95] bg-black flex flex-col m-0 p-0 overflow-hidden touch-none overscroll-none select-none"
    >
      {landscapeStageContent}
    </div>
  );
};

export default BeachBuggyTrack;
