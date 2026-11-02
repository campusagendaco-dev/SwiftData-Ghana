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
    skyTop: "#1d7fd6",
    skyMid: "#7ecbf0",
    skyBot: "#fff4d2",
    hill1: "#5c9ec2",
    hill2: "#387c9e",
    groundLight: "#f4dca6",
    groundDark: "#ebd096",
    shoulderLight: "#d9b97a",
    shoulderDark: "#cfae6e",
    waterLight: "#22b8cf",
    waterDark: "#159ab0",
    roadLight: "#5c5b63",
    roadDark: "#525159",
    fogRgb: "225, 242, 250",
  },
  {
    id: "aburi",
    name: "Aburi Hills & Akuapem Ridge",
    subtitle: "Steep Mountain Hairpins • Lush Ridge Forest • Laterite Shoulders",
    badge: "⛰️ MOUNTAIN",
    skyTop: "#0f5257",
    skyMid: "#4ea898",
    skyBot: "#d8f3dc",
    hill1: "#2d6a4f",
    hill2: "#1b4332",
    groundLight: "#3b7a57",
    groundDark: "#2e6446",
    shoulderLight: "#c46d3b",
    shoulderDark: "#a85729",
    waterLight: "#1e6091",
    waterDark: "#184e77",
    roadLight: "#495057",
    roadDark: "#3e444a",
    fogRgb: "216, 243, 220",
  },
  {
    id: "motorway",
    name: "Tema Motorway & Black Star Sprint",
    subtitle: "Accra Sunset Highway • Kente Curbs • High-Speed Straightaways",
    badge: "🌉 HIGHWAY",
    skyTop: "#311042",
    skyMid: "#9d3656",
    skyBot: "#ffb75e",
    hill1: "#4a2559",
    hill2: "#2c1338",
    groundLight: "#8c6d53",
    groundDark: "#785b42",
    shoulderLight: "#a68568",
    shoulderDark: "#917156",
    waterLight: "#284b63",
    waterDark: "#1d3557",
    roadLight: "#3d4047",
    roadDark: "#32353b",
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
}) => {
  const screenFit = useDeviceScreenFit();
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
  const [endSummary, setEndSummary] = useState<{
    won: boolean;
    wrecked: boolean;
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

    const W = 960;
    const H = 540;
    const HY = H * 0.44;
    const segL = 200;
    const roadW = 2200;
    const lanes = 3;
    const drawN = 230;
    const camH = 1100;
    const camD = 1 / Math.tan((50 * Math.PI) / 180);
    const playerZ = camH * camD;
    const MAX = 12000;
    const ACC = MAX / 4.5;
    const BRK = MAX;
    const DEC = MAX / 5;
    const OFFDEC = MAX / 2.2;
    const OFFLIM = MAX * 0.42;
    const CENT = 0.32;
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
      boost: 55,
      hp: 100,
      inv: 0,
      coins: 0,
      pad: 0,
      boosting: false,
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
        boost: 60,
        hp: 100,
        inv: 0,
        coins: 0,
        pad: 0,
        boosting: false,
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

    function triggerGameOver() {
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
          wrecked: true,
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

      if (r <= 2) {
        playLevelUpFanfare();
        triggerHapticSensor("win");
        onPointsEarnedRef.current?.(
          r === 1 ? 85 : 45,
          r === 1
            ? "🏆 1st Place Labadi Buggy GP Finish!"
            : "🥈 2nd Place Podium Finish!"
        );
      }

      window.setTimeout(() => {
        setEndSummary({
          won: r === 1,
          wrecked: false,
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

      if (racing) {
        const bo = Boolean(keys.boost && P.boost > 0 && P.speed > MAX * 0.25);
        P.boosting = bo || P.pad > 0;
        if (bo) {
          P.boost = Math.max(
            0,
            P.boost - 25 * (1 - curSave.up.nit * 0.1) * dt
          );
        } else {
          P.boost = Math.min(
            100,
            P.boost + (2.8 + curSave.up.nit * 0.85) * dt
          );
        }
        if (P.pad > 0) P.pad -= dt;
        P.time += dt;

        const up = Boolean(keys.up || (autoGasRef.current && !keys.down));
        const cap =
          MAX *
          veh.speedBonus *
          (1 + curSave.up.eng * 0.045) *
          (P.boosting ? 1.32 : 1);

        if (up) {
          P.speed +=
            ACC *
            veh.speedBonus *
            (1 + curSave.up.eng * 0.08) *
            (P.boosting ? 2.4 : 1) *
            dt;
        } else if (keys.down) {
          P.speed -= BRK * dt;
        } else {
          P.speed -= DEC * dt;
        }

        if (P.speed > cap) P.speed = Math.max(cap, P.speed - MAX * 0.6 * dt);

        const dx = dt * 2.45 * veh.steerBonus * sp;
        const tg = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        P.x += tg * dx;
        P.st += (tg - P.st) * Math.min(1, dt * 9);
        P.x -= dx * sp * ps.curve * CENT;

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
        P.speed = clamp(P.speed, 0, MAX * 1.75);

        if (ps.boost && Math.abs(P.x) < 0.85 && P.lastPad !== ps.i) {
          P.pad = 1.6;
          P.boost = Math.min(100, P.boost + 22);
          P.lastPad = ps.i;
          playBeep(990, 0.25);
          triggerHapticSensor("capture");
          onPointsEarnedRef.current?.(12, "⚡ Hit Kente Turbo Boost Pad!");
        }
        if (!ps.boost) P.lastPad = -1;

        for (const s of ps.sprites) {
          if (
            s.w &&
            Math.abs(P.x - s.o) < 0.2 + s.w * 0.55 &&
            P.speed > MAX * 0.1
          ) {
            P.speed = MAX * 0.12;
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
            if (s.t === "coin" && !s.got && Math.abs(P.x - s.o) < 0.34) {
              s.got = 1;
              P.coins++;
              playBeep(1200 + (P.coins % 8) * 60, 0.08, 0.06);
              if (P.coins % 4 === 0) {
                onPointsEarnedRef.current?.(
                  10,
                  "🪙 Collected Ghana Cedi Track Coins!"
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
            35,
            `🏁 Completed Lap ${currentLap - 1} of ${LAPS}!`
          );
        }

        syncProgressToArena(false, false, false);
      } else if (auto) {
        P.speed = Math.max(MAX * 0.25, P.speed - MAX * 0.1 * dt);
        P.x *= 1 - dt * 1.5;
        P.st *= 0.9;
      } else if (st === "over") {
        P.speed = Math.max(0, P.speed - MAX * 1.2 * dt);
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
        (Math.abs(P.x) > 1.05 || P.boosting || Math.random() < 0.15)
      ) {
        const off = Math.abs(P.x) > 1.05;
        for (const sx of [-55, 55]) {
          parts.push({
            x: W / 2 + sx,
            y: H * 0.9,
            vx: (Math.random() - 0.5) * 60 - sx * 0.5,
            vy: -40 - Math.random() * 60,
            l: 0.7,
            m: 0.7,
            r: 6 + Math.random() * 8,
            c: P.boosting && !off ? "255,170,40" : "236,210,160",
            a: off ? 0.6 : 0.3,
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
          55 + sp * 170 + (P.boosting ? 35 : 0);
        engineFilterRef.current.frequency.value = 300 + sp * 900;
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
      let g = ctx!.createLinearGradient(0, 0, 0, HY);
      g.addColorStop(0, trk.skyTop);
      g.addColorStop(0.7, trk.skyMid);
      g.addColorStop(1, trk.skyBot);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, W, HY + 2);

      const sx = W * 0.72 - ((bgX * 0.03) % W);
      ctx!.fillStyle = "rgba(255,245,200,.25)";
      ctx!.beginPath();
      ctx!.arc(sx, HY * 0.5, 80, 0, 7);
      ctx!.fill();
      ctx!.fillStyle = "#fff7c2";
      ctx!.beginPath();
      ctx!.arc(sx, HY * 0.5, 34, 0, 7);
      ctx!.fill();

      ctx!.fillStyle = "rgba(255,255,255,.82)";
      for (let i = 0; i < 5; i++) {
        const cx =
          ((((i * 260 + gt * 6 - bgX * 0.1) % 1300) + 1300) % 1300) - 170;
        const cy = 40 + ((i * 28) % 110);
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
        ctx!.moveTo(0, HY);
        for (let x = 0; x <= W; x += 8) {
          const u = ((x + bgX * f * 10) * 2 * Math.PI) / P0;
          const y =
            HY -
            14 -
            Math.abs(Math.sin(u * (1 + j))) * a -
            Math.abs(Math.sin(u * 3.3 + j)) * b * 0.5;
          ctx!.lineTo(x, y);
        }
        ctx!.lineTo(W, HY);
        ctx!.fill();
      });

      g = ctx!.createLinearGradient(0, HY - 18, 0, HY);
      g.addColorStop(0, trk.waterLight);
      g.addColorStop(1, trk.waterDark);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, HY - 18, W, 19);
      ctx!.fillStyle = "rgba(255,255,255,.6)";
      for (let i = 0; i < 26; i++) {
        ctx!.fillRect(
          (i * 97 + gt * 14) % W,
          HY - 16 + ((i * 7) % 14),
          10 + (i % 3) * 6,
          1.5
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
      ctx!.fillRect(0, b.y, W, a.y - b.y + 1);

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
        W + 200,
        a.y,
        W + 200,
        b.y,
        b.x + b.w * 3.15,
        b.y,
        L ? trk.waterLight : trk.waterDark
      );
      poly(
        a.x + a.w * 3.1,
        a.y,
        a.x + a.w * 3.3,
        a.y,
        b.x + b.w * 3.3,
        b.y,
        b.x + b.w * 3.1,
        b.y,
        "rgba(255,255,255,.75)"
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

      if (s.boost) {
        poly(
          a.x - a.w * 0.55,
          a.y,
          a.x + a.w * 0.55,
          a.y,
          b.x + b.w * 0.55,
          b.y,
          b.x - b.w * 0.55,
          b.y,
          "rgba(255,196,20," +
            (0.55 + ((Math.floor(gt * 8) + s.i) % 2 ? 0.25 : 0)) +
            ")"
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
        ctx!.fillRect(0, b.y, W, a.y - b.y + 1);
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
      vehicleStyle: GhanaVehicleId = "buggy"
    ) {
      const u = w / 100;
      ctx!.save();
      ctx!.translate(x, y - bounce);
      ctx!.fillStyle = "rgba(0,0,0,.32)";
      ctx!.beginPath();
      ctx!.ellipse(0, bounce + u * 2, u * 55, u * 7, 0, 0, 7);
      ctx!.fill();

      for (const s of [-1, 1]) {
        const wx = s * 42 * u;
        ctx!.fillStyle = "#161616";
        ctx!.beginPath();
        ctx!.roundRect(wx - 11 * u, -34 * u, 22 * u, 34 * u, 6 * u);
        ctx!.fill();
        ctx!.fillStyle = "#2b2b2b";
        for (let i = 0; i < 5; i++) {
          ctx!.fillRect(wx - 11 * u, -31 * u + i * 7 * u, 22 * u, 2 * u);
        }
      }

      ctx!.translate(steer * 2 * u, 0);
      ctx!.fillStyle = "#2a2a2e";
      ctx!.fillRect(-28 * u, -20 * u, 56 * u, 10 * u);

      ctx!.fillStyle = col;
      ctx!.beginPath();
      ctx!.roundRect(-33 * u, -40 * u, 66 * u, 24 * u, 8 * u);
      ctx!.fill();

      ctx!.fillStyle = "#dc2626";
      ctx!.fillRect(-30 * u, -39 * u, 20 * u, 4 * u);
      ctx!.fillStyle = "#facc15";
      ctx!.fillRect(-10 * u, -39 * u, 20 * u, 4 * u);
      ctx!.fillStyle = "#16a34a";
      ctx!.fillRect(10 * u, -39 * u, 20 * u, 4 * u);

      ctx!.fillStyle = "#222";
      ctx!.beginPath();
      ctx!.roundRect(-20 * u, -52 * u, 40 * u, 14 * u, 4 * u);
      ctx!.fill();
      ctx!.fillStyle = "#555";
      for (let i = 0; i < 4; i++) {
        ctx!.fillRect(-16 * u + i * 9 * u, -50 * u, 5 * u, 10 * u);
      }

      if (vehicleStyle === "pragya") {
        ctx!.fillStyle = "#facc15";
        ctx!.beginPath();
        ctx!.roundRect(-26 * u, -84 * u, 52 * u, 10 * u, 5 * u);
        ctx!.fill();
      } else if (vehicleStyle === "trotro") {
        ctx!.fillStyle = col;
        ctx!.beginPath();
        ctx!.roundRect(-29 * u, -82 * u, 58 * u, 30 * u, 6 * u);
        ctx!.fill();
        ctx!.fillStyle = "#0f172a";
        ctx!.fillRect(-24 * u, -76 * u, 48 * u, 14 * u);
      }

      ctx!.strokeStyle = "#d8d8de";
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

      ctx!.fillStyle = "#f0c9a0";
      ctx!.beginPath();
      ctx!.arc(0, -68 * u, 7 * u, 0, 7);
      ctx!.fill();
      ctx!.fillStyle = col;
      ctx!.beginPath();
      ctx!.arc(0, -69 * u, 8.5 * u, Math.PI, 0);
      ctx!.fill();
      ctx!.fillStyle = "#111";
      ctx!.fillRect(-7 * u, -68 * u, 14 * u, 3 * u);
      ctx!.fillStyle = col;
      ctx!.beginPath();
      ctx!.roundRect(-9 * u, -62 * u, 18 * u, 14 * u, 4 * u);
      ctx!.fill();

      for (const s of [-1, 1]) {
        ctx!.fillStyle = "#888";
        ctx!.beginPath();
        ctx!.arc(s * 14 * u, -16 * u, 5 * u, 0, 7);
        ctx!.fill();
        ctx!.fillStyle = "#222";
        ctx!.beginPath();
        ctx!.arc(s * 14 * u, -16 * u, 3 * u, 0, 7);
        ctx!.fill();
        if (flame) {
          ctx!.fillStyle =
            "rgba(255," + ((120 + Math.random() * 100) | 0) + ",30,.92)";
          ctx!.beginPath();
          ctx!.moveTo(s * 14 * u - 4 * u, -14 * u);
          ctx!.lineTo(s * 14 * u, (8 + Math.random() * 14) * u);
          ctx!.lineTo(s * 14 * u + 4 * u, -14 * u);
          ctx!.fill();
        }
        ctx!.fillStyle = "#ff2a2a";
        ctx!.fillRect(s * 28 * u - 4 * u, -34 * u, 8 * u, 5 * u);
      }
      ctx!.restore();
    }

    let vg: CanvasGradient | null = null;
    function drawPostEffects() {
      const sp = P.speed / MAX;
      if (!vg) {
        vg = ctx!.createRadialGradient(
          W / 2,
          H / 2,
          H * 0.35,
          W / 2,
          H / 2,
          H * 0.95
        );
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,10,30,.55)");
      }
      if (sp > 0.6 || P.boosting) {
        const a = P.boosting ? 0.55 : (sp - 0.6) * 0.6;
        ctx!.strokeStyle = "rgba(255,255,255," + a * 0.5 + ")";
        ctx!.lineWidth = 2;
        for (let i = 0; i < 36; i++) {
          const rr =
            H * 0.3 +
            (((gt * (P.boosting ? 3 : 1.6) + i * 0.137) % 1) * H * 0.8);
          const c = Math.cos(i * 1.9);
          const s = Math.sin(i * 1.9);
          const r2 = rr + 60 + sp * 60;
          ctx!.beginPath();
          ctx!.moveTo(W / 2 + c * rr, HY + s * rr * 0.8);
          ctx!.lineTo(W / 2 + c * r2, HY + s * r2 * 0.8);
          ctx!.stroke();
        }
      }
      if (P.boosting) {
        ctx!.fillStyle = "rgba(255,120,20,.10)";
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
      ctx!.fillStyle = "rgba(8,30,48,.68)";
      ctx!.beginPath();
      ctx!.roundRect(x, y, w, h, 12);
      ctx!.fill();
      ctx!.strokeStyle = "rgba(255,255,255,.35)";
      ctx!.lineWidth = 2;
      ctx!.stroke();
    }

    function drawHud() {
      const r = getRank();
      const lap = Math.min(LAPS, Math.floor((P.tot - playerZ) / trackLen) + 1);

      ctx!.textAlign = "left";
      drawPill(16, 14, 155, 70);
      ctx!.fillStyle = "#fff";
      ctx!.font = "700 13px Trebuchet MS, sans-serif";
      ctx!.fillText("POSITION", 28, 34);
      ctx!.font = "900 40px Impact, sans-serif";
      ctx!.fillStyle = "#ffd24a";
      ctx!.fillText(String(r), 28, 72);
      ctx!.font = "900 22px Impact, sans-serif";
      ctx!.fillStyle = "#fff";
      ctx!.fillText("/ 6", 60, 72);
      ctx!.font = "900 16px Impact, sans-serif";
      ctx!.fillText(["", "1st", "2nd", "3rd", "4th", "5th", "6th"][r], 112, 72);

      drawPill(W - 186, 14, 170, 70);
      ctx!.fillStyle = "#fff";
      ctx!.font = "700 13px Trebuchet MS, sans-serif";
      ctx!.fillText("LAP", W - 172, 34);
      ctx!.font = "900 34px Impact, sans-serif";
      ctx!.fillText(lap + " / " + LAPS, W - 172, 66);
      ctx!.font = "700 13px Trebuchet MS, sans-serif";
      ctx!.textAlign = "right";
      ctx!.fillText(P.time.toFixed(1) + " s", W - 26, 34);

      const bx = W / 2 - 170;
      const by = 26;
      ctx!.fillStyle = "rgba(8,30,48,.68)";
      ctx!.beginPath();
      ctx!.roundRect(bx - 10, by - 12, 360, 32, 16);
      ctx!.fill();
      ctx!.fillStyle = "#ffffff55";
      ctx!.fillRect(bx, by + 2, 340, 4);

      const prog = (t: number) => clamp((t - playerZ) / (LAPS * trackLen), 0, 1);
      cars.forEach((c) => {
        ctx!.fillStyle = c.col;
        ctx!.beginPath();
        ctx!.arc(bx + 340 * prog(c.tot), by + 4, 5, 0, 7);
        ctx!.fill();
      });

      if (mode === "p2p" && initialStateRef.current) {
        const oppProg =
          mySide === "creator"
            ? Number(initialStateRef.current.opponentProgress || 0)
            : Number(initialStateRef.current.creatorProgress || 0);
        ctx!.fillStyle = "#22d3ee";
        ctx!.beginPath();
        ctx!.arc(bx + 340 * clamp(oppProg, 0, 1), by + 4, 6, 0, 7);
        ctx!.fill();
      }

      const myVeh =
        GHANA_VEHICLES.find((v) => v.id === saveRef.current.vehicle) ||
        GHANA_VEHICLES[0];
      ctx!.fillStyle = myVeh.color;
      ctx!.strokeStyle = "#fff";
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(bx + 340 * prog(P.tot), by + 4, 7, 0, 7);
      ctx!.fill();
      ctx!.stroke();

      drawPill(16, H - 140, 128, 34);
      ctx!.textAlign = "left";
      ctx!.fillStyle = "#ffd23a";
      ctx!.font = "900 20px Impact, sans-serif";
      ctx!.fillText("GH₵ " + P.coins * 15, 26, H - 116);

      const cx = W - 110;
      const cy = H - 96;
      const R = 76;
      ctx!.fillStyle = "rgba(8,30,48,.68)";
      ctx!.beginPath();
      ctx!.arc(cx, cy, R + 8, 0, 7);
      ctx!.fill();
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      const sp = clamp(P.speed / (MAX * 1.32), 0, 1);
      ctx!.lineWidth = 10;
      ctx!.lineCap = "round";
      ctx!.strokeStyle = "#ffffff30";
      ctx!.beginPath();
      ctx!.arc(cx, cy, R - 8, a0, a1);
      ctx!.stroke();
      ctx!.strokeStyle = P.boosting ? "#ffa63a" : "#4cf0ff";
      ctx!.beginPath();
      ctx!.arc(cx, cy, R - 8, a0, a0 + (a1 - a0) * sp);
      ctx!.stroke();
      ctx!.textAlign = "center";
      ctx!.fillStyle = "#fff";
      ctx!.font = "900 40px Impact, sans-serif";
      ctx!.fillText(String(Math.round((P.speed / MAX) * 180)), cx, cy + 10);
      ctx!.font = "700 12px Trebuchet MS, sans-serif";
      ctx!.fillText("KM/H", cx, cy + 30);

      drawPill(16, H - 52, 230, 36);
      ctx!.fillStyle = "#ffffff25";
      ctx!.fillRect(66, H - 40, 168, 12);
      const g = ctx!.createLinearGradient(66, 0, 234, 0);
      g.addColorStop(0, "#ffd24a");
      g.addColorStop(1, "#ff3b1a");
      ctx!.fillStyle = g;
      ctx!.fillRect(66, H - 40, (168 * P.boost) / 100, 12);
      ctx!.textAlign = "left";
      ctx!.fillStyle = "#fff";
      ctx!.font = "900 15px Impact, sans-serif";
      ctx!.fillText("NITRO", 24, H - 28);

      drawPill(16, H - 96, 230, 36);
      ctx!.fillStyle = "#ffffff25";
      ctx!.fillRect(66, H - 84, 168, 12);
      ctx!.fillStyle =
        P.inv > 0 && Math.floor(time * 10) % 2
          ? "#fff"
          : P.hp > 50
          ? "#3de07a"
          : P.hp > 25
          ? "#ffb02e"
          : "#ff3b3b";
      ctx!.fillRect(66, H - 84, (168 * P.hp) / 100, 12);
      ctx!.fillStyle = "#fff";
      ctx!.font = "900 16px Impact, sans-serif";
      ctx!.fillText("ARMOR", 22, H - 72);
    }

    function render() {
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
      drawBackground();

      const pos = (((P.tot - playerZ) % trackLen) + trackLen) % trackLen;
      const base = findSeg(pos);
      const bp = (pos % segL) / segL;
      const ps = findSeg(pos + playerZ);
      const pp = ((pos + playerZ) % segL) / segL;
      const py = lerp(ps.p1.world.y, ps.p2.world.y, pp);

      let mx = H;
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
          ctx!.rect(0, 0, W, s.clip);
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
          const w = (sc * 1000 * W) / 2;
          if (w < 3) continue;
          ctx!.save();
          ctx!.beginPath();
          ctx!.rect(0, 0, W, s.clip);
          ctx!.clip();
          drawBuggy(
            cx,
            cy,
            w,
            c.col,
            Math.sin(time * 2 + c.ph) * 0.5,
            Math.sin(time * 30 + c.ph) * w * 0.01,
            false,
            "buggy"
          );
          if (f > 0.02) {
            ctx!.fillStyle = `rgba(${trk.fogRgb},${f * 0.9})`;
            ctx!.fillRect(cx - w * 0.6, cy - w * 0.9, w * 1.2, w * 0.9);
          }
          ctx!.restore();
        }
      }

      for (const p of parts) {
        ctx!.fillStyle = "rgba(" + p.c + "," + (p.a * p.l) / p.m + ")";
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, 7);
        ctx!.fill();
      }

      const sp = P.speed / MAX;
      const bn = P.speed > 200 ? Math.sin(time * 40) * sp * 2.2 : 0;
      ctx!.save();
      ctx!.translate(W / 2, H * 0.9);
      ctx!.rotate(P.st * 0.04 * sp + ps.curve * 0.004 * sp);
      ctx!.translate(-W / 2, -H * 0.9);
      if (!(P.inv > 0 && Math.floor(time * 14) % 2)) {
        drawBuggy(
          W / 2,
          H * 0.9,
          230,
          myVeh.color,
          P.st,
          bn,
          P.boosting && st !== "over",
          myVeh.id
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
        ctx!.translate(W / 2, H * 0.35);
        ctx!.scale(k, k);
        ctx!.font = "900 140px Impact, sans-serif";
        ctx!.textAlign = "center";
        ctx!.lineWidth = 10;
        ctx!.strokeStyle = "#6b1d0b";
        ctx!.strokeText(t, 0, 0);
        ctx!.fillStyle = n > 0 ? "#ffd24a" : "#5dff7a";
        ctx!.fillText(t, 0, 0);
        ctx!.restore();
      } else if (st === "race" && P.time < 1.2) {
        ctx!.font = "900 120px Impact, sans-serif";
        ctx!.textAlign = "center";
        ctx!.globalAlpha = 1 - P.time / 1.2;
        ctx!.lineWidth = 9;
        ctx!.strokeStyle = "#1d5a14";
        ctx!.strokeText("GO!", W / 2, H * 0.35);
        ctx!.fillStyle = "#5dff7a";
        ctx!.fillText("GO!", W / 2, H * 0.35);
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

  return (
    <div className="w-full flex flex-col items-center select-none touch-none">
      {/* Top Bar Info Strip */}
      <div className="w-full max-w-[960px] flex flex-wrap items-center justify-between gap-2 px-3 py-2 mb-1.5 rounded-2xl bg-slate-900/90 border border-white/10">
        <div className="flex items-center gap-2">
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-black text-white flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Lobby
            </button>
          )}
          <span className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-400/30 text-[11px] font-black text-amber-300">
            {activeTrackMeta.badge} {activeTrackMeta.name}
          </span>
          <span className="hidden sm:inline-flex px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-black text-emerald-300">
            🏎️ {activeVehicleMeta.name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-xl bg-slate-950 border border-white/10 text-xs font-black text-amber-300">
            💰 GH₵ {saveData.bank.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setAutoGas((v) => !v)}
            className={`px-2.5 py-1 rounded-xl text-[10px] font-black border ${
              autoGas
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
                : "bg-white/5 text-slate-400 border-white/10"
            }`}
          >
            Auto-Gas: {autoGas ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white"
            title={muted ? "Unmute Engine Sound" : "Mute Engine Sound"}
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-rose-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main 16:9 Pseudo-3D Racing Viewport */}
      <div
        className="relative w-full max-w-[960px] aspect-video rounded-2xl overflow-hidden bg-black border-2 border-amber-500/30 shadow-2xl"
        style={{
          maxHeight: screenFit.isLandscape
            ? `${Math.max(260, screenFit.availHeight - 58)}px`
            : undefined,
        }}
      >
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          className="w-full h-full block"
        />

        {/* ── 1. START / TRACK & RIDE MENU OVERLAY ────────────────────────── */}
        {uiScreen === "menu" && (
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/85 to-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-between p-4 sm:p-6 text-center overflow-y-auto">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-gradient-to-r from-red-600 via-amber-400 to-emerald-600 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                🇬🇭 Ghana Coastal &amp; Mountain Rally GP
              </div>
              <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tight bg-gradient-to-b from-amber-200 via-amber-400 to-orange-600 bg-clip-text text-transparent drop-shadow">
                Labadi Beach &amp; Aburi Buggy GP
              </h1>
              <p className="text-xs text-slate-300 max-w-xl mx-auto">
                3 Laps • 6 Racers ({creatorName} vs {opponentName} &amp; Pack) • Hit
                Kente Boost Pads • Collect GH₵ Coins &amp; Earn Free Data Points!
              </p>
            </div>

            {/* Circuit Selector */}
            <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-2 my-2">
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
                    className={`p-2.5 rounded-xl border text-left transition ${
                      selected
                        ? "bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/40"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-amber-300">
                        {trk.badge}
                      </span>
                      {selected && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-black text-white mt-0.5 truncate">
                      {trk.name}
                    </p>
                    <p className="text-[10px] text-slate-400 line-clamp-1">
                      {trk.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Vehicle Selector */}
            <div className="w-full max-w-2xl grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                    className={`p-2 rounded-xl border text-left transition ${
                      selected
                        ? "bg-emerald-500/20 border-emerald-400 ring-2 ring-emerald-400/40"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-white/40"
                        style={{ background: v.color }}
                      />
                      <span className="text-[11px] font-black text-white truncate">
                        {v.name}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400 line-clamp-1 mt-0.5">
                      {v.tagline}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => startRaceFnRef.current?.()}
                className="px-7 py-3 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-600 text-slate-950 font-black text-sm sm:text-base tracking-wider uppercase shadow-xl flex items-center gap-2 hover:scale-105 active:scale-95 transition"
              >
                <Play className="w-5 h-5 fill-current" />
                Start 3-Lap Race
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHapticSensor("tap");
                  setUiScreen("garage");
                }}
                className="px-5 py-3 rounded-full bg-gradient-to-r from-sky-500 to-blue-700 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition"
              >
                <Wrench className="w-4 h-4" />
                Suame Garage (GH₵ {saveData.bank})
              </button>
            </div>
          </div>
        )}

        {/* ── 2. SUAME MAGAZINE MECHANIC GARAGE OVERLAY ───────────────────── */}
        {uiScreen === "garage" && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto">
            <div className="text-center space-y-1">
              <h2 className="text-xl sm:text-3xl font-black uppercase text-amber-400 flex items-center justify-center gap-2">
                <Wrench className="w-6 h-6" />
                Suame Magazine Mechanic Workshop
              </h2>
              <p className="text-xs sm:text-sm text-slate-300">
                Workshop Balance:{" "}
                <strong className="text-emerald-400 font-black">
                  GH₵ {saveData.bank.toLocaleString()}
                </strong>{" "}
                {saveData.best > 0 && (
                  <span>• Best 3-Lap Record: {saveData.best.toFixed(1)}s</span>
                )}
              </p>
            </div>

            <div className="w-full max-w-xl space-y-2.5 my-2">
              {(["eng", "nit", "arm"] as const).map((k) => {
                const lvl = saveData.up[k];
                const c = upgradeCost(lvl);
                const meta = UPGRADE_META[k];
                const Icon =
                  k === "eng" ? Gauge : k === "nit" ? Flame : Shield;
                return (
                  <div
                    key={k}
                    className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900 border border-white/15"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-black text-white">
                            {meta.title}
                          </span>
                          <span className="text-xs font-mono text-amber-400">
                            {"●".repeat(lvl)}
                            {"○".repeat(5 - lvl)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {meta.subtitle}
                        </p>
                      </div>
                    </div>

                    {lvl < 5 ? (
                      <button
                        type="button"
                        disabled={saveData.bank < c}
                        onClick={() => handleBuyUpgrade(k)}
                        className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-black text-xs shrink-0"
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
                className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-black text-xs uppercase"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => startRaceFnRef.current?.()}
                className="px-7 py-2.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs uppercase flex items-center gap-1.5"
              >
                <Play className="w-4 h-4 fill-current" />
                Race Now
              </button>
            </div>
          </div>
        )}

        {/* ── 3. RACE FINISH / GAME OVER SUMMARY OVERLAY ──────────────────── */}
        {uiScreen === "end" && endSummary && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-5 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
              {endSummary.wrecked ? (
                <Flame className="w-8 h-8 text-rose-400" />
              ) : (
                <Trophy className="w-8 h-8 text-amber-300" />
              )}
            </div>

            <h2 className="text-2xl sm:text-4xl font-black uppercase text-amber-300">
              {endSummary.wrecked
                ? "💥 Buggy Wrecked!"
                : endSummary.rank === 1
                ? "🏆 1st Place Champion!"
                : `🏁 Finished #${endSummary.rank} of 6`}
            </h2>

            <p className="text-xs sm:text-sm text-slate-200 max-w-md">
              {endSummary.wrecked
                ? `Crashed out on Lap ${endSummary.lap} of 3. Upgrade Kantanka Armor in Suame Garage or dodge roadside rocks & coconut palms!`
                : `Completed 3 Laps on ${activeTrackMeta.name} in ${endSummary.raceTime.toFixed(
                    2
                  )}s!`}
            </p>

            <div className="px-4 py-2.5 rounded-2xl bg-slate-900 border border-white/10 text-xs font-bold text-emerald-300 space-y-1">
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

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => startRaceFnRef.current?.()}
                className="px-6 py-2.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-xs sm:text-sm uppercase flex items-center gap-1.5 shadow-lg"
              >
                <RotateCcw className="w-4 h-4" />
                Race Again
              </button>
              <button
                type="button"
                onClick={() => setUiScreen("garage")}
                className="px-5 py-2.5 rounded-full bg-sky-600 hover:bg-sky-500 text-white font-black text-xs sm:text-sm uppercase flex items-center gap-1.5"
              >
                <Wrench className="w-4 h-4" />
                Suame Garage
              </button>
            </div>
          </div>
        )}

        {/* ── 4. ON-SCREEN TOUCH PEDALS & STEERING (ISOLATED POINTER EVENTS) ─ */}
        {uiScreen === "racing" && (
          <div className="absolute inset-x-0 bottom-2.5 px-3 sm:px-5 flex items-center justify-between pointer-events-none z-20">
            <div className="flex items-center gap-2.5 pointer-events-auto">
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setTouchKey("left", 1);
                }}
                onPointerUp={() => setTouchKey("left", 0)}
                onPointerCancel={() => setTouchKey("left", 0)}
                onPointerLeave={() => setTouchKey("left", 0)}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 active:bg-amber-400 active:text-slate-950 border-2 border-white/75 text-white font-black text-xl flex items-center justify-center shadow-lg backdrop-blur-sm"
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
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 active:bg-amber-400 active:text-slate-950 border-2 border-white/75 text-white font-black text-xl flex items-center justify-center shadow-lg backdrop-blur-sm"
                aria-label="Steer Right"
              >
                ▶
              </button>
            </div>

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
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-600/80 active:bg-emerald-400 border-2 border-white text-white font-black text-xs flex items-center justify-center shadow-lg"
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
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 active:bg-rose-500 border-2 border-white/75 text-white font-black text-lg flex items-center justify-center shadow-lg backdrop-blur-sm"
                aria-label="Brake"
              >
                ■
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
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-amber-400 to-red-600 active:scale-95 border-2 border-white text-slate-950 font-black text-base flex flex-col items-center justify-center shadow-xl"
                aria-label="Nitro Boost"
              >
                <span className="leading-none">🔥</span>
                <span className="text-[11px] font-black leading-none">N₂</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BeachBuggyTrack;

