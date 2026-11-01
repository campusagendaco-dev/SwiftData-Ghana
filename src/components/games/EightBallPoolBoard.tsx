import React, { useState, useEffect, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RotateCcw,
  Maximize2,
  Minimize2,
  Smartphone,
  Crosshair,
  Zap,
  Sparkles,
  Volume2,
  VolumeX,
  Vibrate,
  Compass,
  Brain,
  BellRing,
  Hand,
} from "lucide-react";
import {
  playCueStrikeSound,
  playBallClackSound,
  playRailBounceSound,
  playPocketDropSound,
  playFoulAlertSound,
  playLevelUpFanfare,
  playTurnNotificationSound,
  playFineAimTickSound,
  setGameSensoryPreferences,
  getGameSensoryPreferences,
  getPlayerLevelStatus,
  sampleGaussianError,
} from "@/lib/game-sensory-engine";

export interface PoolBall {
  id: number; // 0 = cue ball, 1..7 = solids, 8 = black 8-ball, 9..15 = stripes
  x: number;
  y: number;
  vx: number;
  vy: number;
  potted: boolean;
}

export interface EightBallPoolState {
  balls: PoolBall[];
  turn: "creator" | "opponent";
  creatorGroup: "solids" | "stripes" | null;
  opponentGroup: "solids" | "stripes" | null;
  ballInHand?: boolean;
  winner: "creator" | "opponent" | "draw" | null;
  lastAction: string;
  shotCount: number;
}

interface FrameAudioEvent {
  type: "clack" | "rail" | "pocket";
  speed: number;
}

// Virtual table dimensions (felt playing area: 800 x 400)
const TABLE_W = 800;
const TABLE_H = 400;
const BALL_R = 13.5;
const POCKET_R = 27;
const FRICTION = 0.986;
const MIN_SPEED = 0.08;

const POCKETS = [
  { x: 10, y: 10 },
  { x: TABLE_W / 2, y: 4 },
  { x: TABLE_W - 10, y: 10 },
  { x: 10, y: TABLE_H - 10 },
  { x: TABLE_W / 2, y: TABLE_H - 4 },
  { x: TABLE_W - 10, y: TABLE_H - 10 },
];

const BALL_COLORS: Record<number, { main: string; stripe: boolean; name: string }> = {
  0: { main: "#ffffff", stripe: false, name: "Cue Ball" },
  1: { main: "#f59e0b", stripe: false, name: "1 Yellow" },
  2: { main: "#1d4ed8", stripe: false, name: "2 Blue" },
  3: { main: "#dc2626", stripe: false, name: "3 Red" },
  4: { main: "#6d28d9", stripe: false, name: "4 Purple" },
  5: { main: "#ea580c", stripe: false, name: "5 Orange" },
  6: { main: "#15803d", stripe: false, name: "6 Green" },
  7: { main: "#7f1d1d", stripe: false, name: "7 Maroon" },
  8: { main: "#111827", stripe: false, name: "8 Black" },
  9: { main: "#f59e0b", stripe: true, name: "9 Yellow Stripe" },
  10: { main: "#1d4ed8", stripe: true, name: "10 Blue Stripe" },
  11: { main: "#dc2626", stripe: true, name: "11 Red Stripe" },
  12: { main: "#6d28d9", stripe: true, name: "12 Purple Stripe" },
  13: { main: "#ea580c", stripe: true, name: "13 Orange Stripe" },
  14: { main: "#15803d", stripe: true, name: "14 Green Stripe" },
  15: { main: "#7f1d1d", stripe: true, name: "15 Maroon Stripe" },
};

const HUMAN_THOUGHT_PHRASES = [
  "Scanning table pockets & angles...",
  "Adjusting fine-aim tray for cut shot...",
  "Lining up cue stick & chalking tip...",
  "Checking cue ball position & spin...",
  "Pulling back right cue stick power tray...",
];

export function createInitialPoolBalls(): PoolBall[] {
  const balls: PoolBall[] = [
    { id: 0, x: 205, y: TABLE_H / 2, vx: 0, vy: 0, potted: false },
  ];

  const rackLayout: number[][] = [
    [1],
    [9, 2],
    [3, 8, 10],
    [11, 4, 12, 5],
    [6, 13, 14, 7, 15],
  ];

  const apexX = 550;
  const apexY = TABLE_H / 2;
  const dx = BALL_R * 1.76;
  const dy = BALL_R * 2.04;

  for (let col = 0; col < rackLayout.length; col++) {
    const colIds = rackLayout[col];
    const startY = apexY - ((colIds.length - 1) * dy) / 2;
    for (let r = 0; r < colIds.length; r++) {
      balls.push({
        id: colIds[r],
        x: Number((apexX + col * dx).toFixed(2)),
        y: Number((startY + r * dy).toFixed(2)),
        vx: 0,
        vy: 0,
        potted: false,
      });
    }
  }

  return balls;
}

export const INITIAL_POOL_STATE: EightBallPoolState = {
  balls: createInitialPoolBalls(),
  turn: "creator",
  creatorGroup: null,
  opponentGroup: null,
  ballInHand: true,
  winner: null,
  lastAction: "Break Shot! Use the Left Fine-Aim Tray to adjust your stick & pull down the Right Cue Tray to break!",
  shotCount: 0,
};

function isBallInGroup(id: number, group: "solids" | "stripes" | null): boolean {
  if (!group) return id >= 1 && id <= 15 && id !== 8;
  if (group === "solids") return id >= 1 && id <= 7;
  return id >= 9 && id <= 15;
}

export interface EightBallPoolBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  playerTotalPoints?: number;
  playerLevel?: number;
  initialState?: Partial<EightBallPoolState>;
  onStateChange?: (state: EightBallPoolState) => void;
  onPointsEarned?: (points: number, reason: string) => void;
  onMatchComplete?: (winner: "creator" | "opponent" | "draw", finalState: EightBallPoolState) => void;
}

export const EightBallPoolBoard: React.FC<EightBallPoolBoardProps> = ({
  mode,
  mySide,
  creatorName,
  opponentName,
  playerTotalPoints = 0,
  initialState,
  onStateChange,
  onPointsEarned,
  onMatchComplete,
}) => {
  const levelInfo = getPlayerLevelStatus(playerTotalPoints);
  const displayOpponentName =
    mode === "p2p"
      ? opponentName || "Challenger 2"
      : `${levelInfo.persona.name} (${levelInfo.persona.city})`;

  const [state, setState] = useState<EightBallPoolState>(() => ({
    ...INITIAL_POOL_STATE,
    ...(initialState || {}),
    balls:
      Array.isArray(initialState?.balls) && initialState!.balls.length === 16
        ? initialState!.balls
        : createInitialPoolBalls(),
  }));

  const [aimAngle, setAimAngle] = useState<number>(0); // radians
  const [shotPower, setShotPower] = useState<number>(65); // 15..100
  const [isPullingPowerTray, setIsPullingPowerTray] = useState<boolean>(false);
  const [fineWheelOffset, setFineWheelOffset] = useState<number>(0); // visual scroll offset of left fine-aim tray ticks
  const [spinOffset, setSpinOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingCueBall, setIsDraggingCueBall] = useState<boolean>(false);

  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isOpponentAiming, setIsOpponentAiming] = useState<boolean>(false);
  const [humanThoughtText, setHumanThoughtText] = useState<string>("");
  const [potStreak, setPotStreak] = useState<number>(0);
  const [floatingRewardText, setFloatingRewardText] = useState<string | null>(null);

  // Turn-change notification spotlight banner state
  const [turnBanner, setTurnBanner] = useState<{
    playerName: string;
    isMe: boolean;
    subtitle: string;
  } | null>(null);

  // Sound, Vibration & Motion Sensor states
  const [soundOn, setSoundOn] = useState<boolean>(() => getGameSensoryPreferences().soundEnabled);
  const [vibeOn, setVibeOn] = useState<boolean>(() => getGameSensoryPreferences().vibrationEnabled);
  const [motionSensorActive, setMotionSensorActive] = useState<boolean>(false);
  const [tiltDegrees, setTiltDegrees] = useState<number>(0);
  const [parallaxOffset, setParallaxOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Strict Portrait Restriction & Fullscreen Landscape Stage
  const [isPortraitViewport, setIsPortraitViewport] = useState<boolean>(false);
  const [forcedLandscape, setForcedLandscape] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const fineTrayRef = useRef<HTMLDivElement | null>(null);
  const powerTrayRef = useRef<HTMLDivElement | null>(null);
  const fineDragLastPosRef = useRef<number | null>(null);
  const lastTickAngleRef = useRef<number>(0);
  const prevTurnRef = useRef<"creator" | "opponent">(state.turn);
  const stateRef = useRef<EightBallPoolState>(state);
  stateRef.current = state;

  // Sync incoming multiplayer state when not actively animating a shot locally
  useEffect(() => {
    if (
      !isSimulating &&
      initialState &&
      Array.isArray(initialState.balls) &&
      initialState.balls.length === 16 &&
      (initialState.shotCount || 0) > (state.shotCount || 0)
    ) {
      setState((prev) => ({
        ...prev,
        ...initialState,
        balls: initialState.balls!,
      }));
    }
  }, [initialState, isSimulating, state.shotCount]);

  // Strictly detect Portrait Viewport (height > width on mobile/tablet screens)
  useEffect(() => {
    const checkOrientation = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const portrait = h > w && w < 960;
      setIsPortraitViewport(portrait);
      // If the user physically turned their phone to landscape, clear forced 90-deg CSS rotation so native landscape shines
      if (!portrait && forcedLandscape) {
        setForcedLandscape(false);
      }
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
    };
  }, [forcedLandscape]);

  const isMyTurn =
    !state.winner &&
    !isSimulating &&
    !isOpponentAiming &&
    (mode === "p2p" ? state.turn === mySide : state.turn === "creator");

  // Trigger Turn Notification Banner & Acoustic Chime whenever `state.turn` or `state.shotCount` updates!
  useEffect(() => {
    if (state.winner || state.shotCount === 0) return;
    const isNowMyTurn = mode === "p2p" ? state.turn === mySide : state.turn === "creator";
    const activePlayerName = state.turn === "creator" ? creatorName : displayOpponentName;

    if (prevTurnRef.current !== state.turn || state.shotCount > 0) {
      prevTurnRef.current = state.turn;
      playTurnNotificationSound(isNowMyTurn);
      setTurnBanner({
        playerName: activePlayerName,
        isMe: isNowMyTurn,
        subtitle: state.ballInHand
          ? "✋ Ball-in-Hand! Drag the white cue ball to place it, then aim & shoot."
          : state.lastAction,
      });

      const timer = window.setTimeout(() => {
        setTurnBanner(null);
      }, 2800);
      return () => window.clearTimeout(timer);
    }
  }, [state.turn, state.shotCount, state.winner, state.ballInHand, state.lastAction, mode, mySide, creatorName, displayOpponentName]);

  // ── DeviceOrientation / Gyroscope Motion Sensor Fine-Aiming & 3D Parallax ──
  const toggleMotionSensor = async () => {
    if (motionSensorActive) {
      setMotionSensorActive(false);
      setTiltDegrees(0);
      setParallaxOffset({ x: 0, y: 0 });
      return;
    }

    try {
      const DevOrient = (window as any).DeviceOrientationEvent;
      if (DevOrient && typeof DevOrient.requestPermission === "function") {
        const perm = await DevOrient.requestPermission();
        if (perm !== "granted") return;
      }
      setMotionSensorActive(true);
    } catch (_e) {
      setMotionSensorActive(true);
    }
  };

  useEffect(() => {
    if (!motionSensorActive) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const rawTilt =
        window.innerWidth > window.innerHeight
          ? Number(e.beta || 0)
          : Number(e.gamma || 0);
      const clampedTilt = Math.max(-25, Math.min(25, rawTilt));
      setTiltDegrees(Number(clampedTilt.toFixed(1)));
      setParallaxOffset({
        x: Number((clampedTilt * 0.35).toFixed(1)),
        y: Number((Math.max(-15, Math.min(15, Number(e.beta || 0) - 35)) * 0.25).toFixed(1)),
      });

      if (Math.abs(clampedTilt) > 1.5 && isMyTurn) {
        setAimAngle((prev) => prev + clampedTilt * 0.00045);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [motionSensorActive, isMyTurn]);

  const handleToggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setGameSensoryPreferences({ sound: next });
  };

  const handleToggleVibe = () => {
    const next = !vibeOn;
    setVibeOn(next);
    setGameSensoryPreferences({ vibration: next });
  };

  const handleEnterLandscapeMode = async () => {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      if ((screen as any)?.orientation?.lock) {
        await (screen as any).orientation.lock("landscape").catch(() => {});
      }
    } catch (_e) {
      // Fallback to CSS 90deg landscape theatre stage
    }
    setForcedLandscape(true);
    playTurnNotificationSound(true);
  };

  /**
   * Adjusts the Pool Cue Stick angle smoothly via the Left Fine-Aiming Wheel Tray
   */
  const adjustStickAngleByDelta = useCallback(
    (deltaRad: number, visualPixels = 0) => {
      if (!isMyTurn) return;
      setAimAngle((prev) => {
        const next = prev + deltaRad;
        if (Math.abs(next - lastTickAngleRef.current) >= 0.011) {
          lastTickAngleRef.current = next;
          playFineAimTickSound();
        }
        return next;
      });
      if (visualPixels !== 0) {
        setFineWheelOffset((prev) => (prev + visualPixels) % 24);
      }
    },
    [isMyTurn]
  );

  // Left Fine-Aiming Wheel Tray Pointer Handlers
  const handleFineTrayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMyTurn) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const coord = forcedLandscape && isPortraitViewport ? e.clientX : e.clientY;
    fineDragLastPosRef.current = coord;
  };

  const handleFineTrayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMyTurn || fineDragLastPosRef.current === null) return;
    e.stopPropagation();
    const coord = forcedLandscape && isPortraitViewport ? e.clientX : e.clientY;
    const deltaPx = coord - fineDragLastPosRef.current;
    fineDragLastPosRef.current = coord;

    // 1 pixel of drag on the fine-aim tray = 0.0032 radians (~0.18 degrees) of ultra-smooth cue stick rotation!
    const directionSign = forcedLandscape && isPortraitViewport ? -1 : 1;
    adjustStickAngleByDelta(deltaPx * 0.0032 * directionSign, deltaPx * directionSign);
  };

  const handleFineTrayPointerUp = () => {
    fineDragLastPosRef.current = null;
  };

  /**
   * Simulates a complete physics shot synchronously into keyframes + acoustic/haptic events,
   * then plays them back smoothly at 60 FPS with velocity-scaled Web Audio clacks & vibrations!
   */
  const executeShot = useCallback(
    (angleRad: number, powerPercent: number, shooter: "creator" | "opponent") => {
      if (isSimulating || stateRef.current.winner) return;

      const current = stateRef.current;
      const simBalls: PoolBall[] = current.balls.map((b) => ({ ...b }));
      const cue = simBalls.find((b) => b.id === 0);
      if (!cue || cue.potted) return;

      playCueStrikeSound(powerPercent);

      const maxSpeed = 23.5;
      const speed = Math.max(3.5, (powerPercent / 100) * maxSpeed);
      // Apply subtle spin offset influence
      const spinAngleAdjust = spinOffset.x * 0.0035;
      const spinSpeedBoost = 1 - spinOffset.y * 0.018;
      cue.vx = Math.cos(angleRad + spinAngleAdjust) * speed * spinSpeedBoost;
      cue.vy = Math.sin(angleRad + spinAngleAdjust) * speed * spinSpeedBoost;

      const pottedThisShot: number[] = [];
      let firstContactId: number | null = null;
      const frames: { balls: PoolBall[]; events: FrameAudioEvent[] }[] = [];
      let pendingEvents: FrameAudioEvent[] = [];

      for (let step = 0; step < 480; step++) {
        let moving = false;

        for (const b of simBalls) {
          if (b.potted) continue;
          b.x += b.vx;
          b.y += b.vy;
          b.vx *= FRICTION;
          b.vy *= FRICTION;

          const spd = Math.hypot(b.vx, b.vy);
          if (spd < MIN_SPEED) {
            b.vx = 0;
            b.vy = 0;
          } else {
            moving = true;
          }

          for (const p of POCKETS) {
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
              b.potted = true;
              b.vx = 0;
              b.vy = 0;
              pottedThisShot.push(b.id);
              pendingEvents.push({ type: "pocket", speed: spd });
              break;
            }
          }
          if (b.potted) continue;

          if (b.x < BALL_R + 6) {
            b.x = BALL_R + 6;
            b.vx = Math.abs(b.vx) * 0.84;
            if (spd > 1.2) pendingEvents.push({ type: "rail", speed: spd });
          } else if (b.x > TABLE_W - BALL_R - 6) {
            b.x = TABLE_W - BALL_R - 6;
            b.vx = -Math.abs(b.vx) * 0.84;
            if (spd > 1.2) pendingEvents.push({ type: "rail", speed: spd });
          }
          if (b.y < BALL_R + 6) {
            b.y = BALL_R + 6;
            b.vy = Math.abs(b.vy) * 0.84;
            if (spd > 1.2) pendingEvents.push({ type: "rail", speed: spd });
          } else if (b.y > TABLE_H - BALL_R - 6) {
            b.y = TABLE_H - BALL_R - 6;
            b.vy = -Math.abs(b.vy) * 0.84;
            if (spd > 1.2) pendingEvents.push({ type: "rail", speed: spd });
          }
        }

        for (let i = 0; i < simBalls.length; i++) {
          const b1 = simBalls[i];
          if (b1.potted) continue;
          for (let j = i + 1; j < simBalls.length; j++) {
            const b2 = simBalls[j];
            if (b2.potted) continue;

            const dx = b2.x - b1.x;
            const dy = b2.y - b1.y;
            const dist = Math.hypot(dx, dy);
            const minDist = BALL_R * 2;

            if (dist > 0 && dist < minDist) {
              if (firstContactId === null && (b1.id === 0 || b2.id === 0)) {
                firstContactId = b1.id === 0 ? b2.id : b1.id;
              }

              const overlap = (minDist - dist) / 2 + 0.05;
              const nx = dx / dist;
              const ny = dy / dist;
              b1.x -= nx * overlap;
              b1.y -= ny * overlap;
              b2.x += nx * overlap;
              b2.y += ny * overlap;

              const kx = b1.vx - b2.vx;
              const ky = b1.vy - b2.vy;
              const p = nx * kx + ny * ky;
              if (p > 0) {
                b1.vx -= p * nx * 0.96;
                b1.vy -= p * ny * 0.96;
                b2.vx += p * nx * 0.96;
                b2.vy += p * ny * 0.96;
                if (p > 0.65) {
                  pendingEvents.push({ type: "clack", speed: p });
                }
              }
            }
          }
        }

        if (step % 2 === 0) {
          frames.push({
            balls: simBalls.map((b) => ({
              ...b,
              x: Number(b.x.toFixed(1)),
              y: Number(b.y.toFixed(1)),
            })),
            events: pendingEvents,
          });
          pendingEvents = [];
        }

        if (!moving && step > 4) break;
      }

      let creatorGroup = current.creatorGroup;
      let opponentGroup = current.opponentGroup;
      const otherPlayer: "creator" | "opponent" = shooter === "creator" ? "opponent" : "creator";
      const shooterLabel = shooter === "creator" ? creatorName : displayOpponentName;

      const cueScratched = pottedThisShot.includes(0);
      const eightBallPotted = pottedThisShot.includes(8);

      if (cueScratched) {
        const cueBall = simBalls.find((b) => b.id === 0)!;
        cueBall.potted = false;
        cueBall.x = 195;
        cueBall.y = TABLE_H / 2 + (Math.random() * 40 - 20);
        cueBall.vx = 0;
        cueBall.vy = 0;
      }

      let newlyAssigned = false;
      if (!creatorGroup && !opponentGroup && !cueScratched && !eightBallPotted) {
        const firstObjectPot = pottedThisShot.find((id) => id >= 1 && id <= 15 && id !== 8);
        if (firstObjectPot !== undefined) {
          const pickedGroup: "solids" | "stripes" = firstObjectPot <= 7 ? "solids" : "stripes";
          const otherGroup: "solids" | "stripes" = pickedGroup === "solids" ? "stripes" : "solids";
          if (shooter === "creator") {
            creatorGroup = pickedGroup;
            opponentGroup = otherGroup;
          } else {
            opponentGroup = pickedGroup;
            creatorGroup = otherGroup;
          }
          newlyAssigned = true;
        }
      }

      const activeShooterGroup = shooter === "creator" ? creatorGroup : opponentGroup;
      const remainingGroupBalls = activeShooterGroup
        ? simBalls.filter((b) => !b.potted && isBallInGroup(b.id, activeShooterGroup)).length
        : 7;

      let winner: "creator" | "opponent" | "draw" | null = null;
      let nextTurn: "creator" | "opponent" = otherPlayer;
      let nextBallInHand = false;
      let actionSummary = "";
      const pottedOwnBalls = pottedThisShot.filter((id) =>
        isBallInGroup(id, activeShooterGroup)
      );

      if (eightBallPotted) {
        const hadClearedGroupBeforeOrDuring =
          activeShooterGroup !== null && remainingGroupBalls === 0 && !cueScratched;
        if (hadClearedGroupBeforeOrDuring) {
          winner = shooter;
          actionSummary = `🏆 ${shooterLabel} legally sank the 8-Ball and won the frame!`;
        } else {
          winner = otherPlayer;
          actionSummary = `⚠️ ${shooterLabel} potted the 8-Ball early/foul! ${
            otherPlayer === "creator" ? creatorName : displayOpponentName
          } wins the frame!`;
        }
      } else if (cueScratched) {
        nextTurn = otherPlayer;
        nextBallInHand = true;
        actionSummary = `⚠️ Foul (Cue ball scratch)! Ball-in-hand for ${
          otherPlayer === "creator" ? creatorName : displayOpponentName
        }.`;
      } else {
        if (pottedOwnBalls.length > 0) {
          nextTurn = shooter;
          actionSummary = newlyAssigned
            ? `🔥 ${shooterLabel} potted Ball #${pottedOwnBalls[0]} and claimed ${activeShooterGroup?.toUpperCase()}! Extra shot!`
            : `🔥 ${shooterLabel} sank ${pottedOwnBalls.map((n) => `#${n}`).join(", ")}! Extra shot!`;
        } else if (pottedThisShot.length > 0) {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} potted opponent's ball (${pottedThisShot
            .map((n) => `#${n}`)
            .join(", ")}). Next turn: ${
            otherPlayer === "creator" ? creatorName : displayOpponentName
          }!`;
        } else if (firstContactId === null) {
          nextTurn = otherPlayer;
          nextBallInHand = true;
          actionSummary = `⚠️ Foul — cue ball missed all object balls! Ball-in-hand for ${
            otherPlayer === "creator" ? creatorName : displayOpponentName
          }!`;
        } else {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} completed their shot. Next turn: ${
            otherPlayer === "creator" ? creatorName : displayOpponentName
          }!`;
        }
      }

      setIsSimulating(true);
      let frameIdx = 0;
      const stepInterval = setInterval(() => {
        if (frameIdx < frames.length) {
          const frame = frames[frameIdx];
          const nextFrame = frames[frameIdx + 1];
          const combinedEvents = [
            ...(frame.events || []),
            ...(nextFrame?.events || []),
          ];

          const hasPocket = combinedEvents.some((e) => e.type === "pocket");
          if (hasPocket) {
            playPocketDropSound();
          } else {
            const loudestClack = combinedEvents
              .filter((e) => e.type === "clack")
              .sort((a, b) => b.speed - a.speed)[0];
            if (loudestClack) {
              playBallClackSound(loudestClack.speed);
            } else {
              const railHit = combinedEvents.find((e) => e.type === "rail");
              if (railHit) playRailBounceSound(railHit.speed);
            }
          }

          setState((prev) => ({
            ...prev,
            balls: frame.balls,
          }));
          frameIdx += 2;
        } else {
          clearInterval(stepInterval);
          const finalState: EightBallPoolState = {
            balls: simBalls.map((b) => ({
              ...b,
              x: Number(b.x.toFixed(1)),
              y: Number(b.y.toFixed(1)),
              vx: 0,
              vy: 0,
            })),
            turn: nextTurn,
            creatorGroup,
            opponentGroup,
            ballInHand: nextBallInHand,
            winner,
            lastAction: actionSummary,
            shotCount: current.shotCount + 1,
          };
          setState(finalState);
          setIsSimulating(false);
          setSpinOffset({ x: 0, y: 0 });

          const isHumanShot =
            (mode === "p2p" && shooter === mySide) ||
            (mode !== "p2p" && shooter === "creator");

          if ((cueScratched || firstContactId === null) && isHumanShot) {
            playFoulAlertSound();
            setPotStreak(0);
          } else if (isHumanShot && pottedOwnBalls.length > 0 && !eightBallPotted) {
            const newStreak = potStreak + pottedOwnBalls.length;
            setPotStreak(newStreak);
            const mult = newStreak >= 3 ? 2 : newStreak === 2 ? 1.5 : 1;
            const earnedPts = Math.round(pottedOwnBalls.length * 40 * mult);
            const label =
              mult > 1
                ? `+${earnedPts} PTS (${mult}× STREAK 🔥)`
                : `+${earnedPts} PTS (Ball Potted 🎱)`;
            setFloatingRewardText(label);
            setTimeout(() => setFloatingRewardText(null), 2400);
            onPointsEarned?.(earnedPts, `Potted Ball ${pottedOwnBalls.map((b) => `#${b}`).join(", ")}`);
          } else if (isHumanShot) {
            setPotStreak(0);
          }

          if (winner) {
            const humanWon =
              (mode === "p2p" && winner === mySide) ||
              (mode !== "p2p" && winner === "creator");
            if (humanWon) {
              playLevelUpFanfare();
              setFloatingRewardText("🏆 +300 PTS FRAME VICTORY!");
              setTimeout(() => setFloatingRewardText(null), 3200);
              onPointsEarned?.(300, "Won 8-Ball Pool Match");
            } else {
              playFoulAlertSound();
            }
            onMatchComplete?.(winner, finalState);
          }

          onStateChange?.(finalState);
        }
      }, 22);
    },
    [
      isSimulating,
      spinOffset,
      creatorName,
      displayOpponentName,
      mode,
      mySide,
      potStreak,
      onStateChange,
      onPointsEarned,
      onMatchComplete,
    ]
  );

  // Right Cue Stick Pull-Back Power Tray Handlers (Drag down to pull cue stick back, release to fire!)
  const updatePowerFromPointer = (clientX: number, clientY: number) => {
    if (!powerTrayRef.current) return 0;
    const rect = powerTrayRef.current.getBoundingClientRect();
    let ratio = 0;
    if (forcedLandscape && isPortraitViewport) {
      ratio = 1 - (clientX - rect.left) / Math.max(1, rect.width);
    } else {
      ratio = (clientY - rect.top) / Math.max(1, rect.height);
    }
    const pct = Math.round(Math.max(10, Math.min(100, ratio * 100)));
    setShotPower(pct);
    return pct;
  };

  const handlePowerTrayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMyTurn) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPullingPowerTray(true);
    updatePowerFromPointer(e.clientX, e.clientY);
  };

  const handlePowerTrayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMyTurn || !isPullingPowerTray) return;
    e.stopPropagation();
    updatePowerFromPointer(e.clientX, e.clientY);
  };

  const handlePowerTrayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPullingPowerTray) return;
    e.stopPropagation();
    setIsPullingPowerTray(false);
    const finalPct = updatePowerFromPointer(e.clientX, e.clientY);
    // If pulled down past 20%, release snaps the cue stick forward and shoots!
    if (isMyTurn && finalPct >= 20) {
      executeShot(aimAngle, finalPct, state.turn);
    }
  };

  // ── Human-Sense Medium Opponent with Visible Cue Sweeping & Gaussian Error ──
  useEffect(() => {
    if (
      (mode === "ai" || mode === "free_data") &&
      state.turn === "opponent" &&
      !state.winner &&
      !isSimulating &&
      !isOpponentAiming
    ) {
      setIsOpponentAiming(true);
      const phrase =
        HUMAN_THOUGHT_PHRASES[Math.floor(Math.random() * HUMAN_THOUGHT_PHRASES.length)];
      setHumanThoughtText(phrase);

      const current = stateRef.current;
      const cue = current.balls.find((b) => b.id === 0);
      if (!cue) {
        setIsOpponentAiming(false);
        return;
      }

      const aiGroup = current.opponentGroup;
      let targets = current.balls.filter(
        (b) => !b.potted && b.id !== 0 && b.id !== 8 && isBallInGroup(b.id, aiGroup)
      );
      if (aiGroup && targets.length === 0) {
        targets = current.balls.filter((b) => !b.potted && b.id === 8);
      }
      if (targets.length === 0) {
        targets = current.balls.filter((b) => !b.potted && b.id !== 0 && b.id !== 8);
      }

      let idealAngle = 0;
      let idealPower = 68;
      let bestScore = -999999;
      let chosenCutCos = 0.8;

      for (const t of targets) {
        for (const p of POCKETS) {
          const toPocketX = p.x - t.x;
          const toPocketY = p.y - t.y;
          const distToPocket = Math.hypot(toPocketX, toPocketY);
          if (distToPocket < 1) continue;

          const ux = toPocketX / distToPocket;
          const uy = toPocketY / distToPocket;
          const ghostX = t.x - ux * (BALL_R * 1.96);
          const ghostY = t.y - uy * (BALL_R * 1.96);

          const toGhostX = ghostX - cue.x;
          const toGhostY = ghostY - cue.y;
          const distToGhost = Math.hypot(toGhostX, toGhostY);
          if (distToGhost < 1) continue;

          const gx = toGhostX / distToGhost;
          const gy = toGhostY / distToGhost;

          const cutCos = gx * ux + gy * uy;
          if (cutCos < 0.25) continue;

          let obstructed = false;
          for (const other of current.balls) {
            if (other.potted || other.id === 0 || other.id === t.id) continue;
            const proj = (other.x - cue.x) * gx + (other.y - cue.y) * gy;
            if (proj > 0 && proj < distToGhost) {
              const perpDist = Math.abs((other.x - cue.x) * -gy + (other.y - cue.y) * gx);
              if (perpDist < BALL_R * 1.95) {
                obstructed = true;
                break;
              }
            }
          }

          const humanEvaluationNoise = (Math.random() - 0.5) * 35;
          const score =
            cutCos * 240 -
            distToPocket * 0.2 -
            distToGhost * 0.14 -
            (obstructed ? 380 : 0) +
            humanEvaluationNoise;

          if (score > bestScore) {
            bestScore = score;
            idealAngle = Math.atan2(toGhostY, toGhostX);
            idealPower = Math.min(88, Math.max(44, 40 + (distToGhost + distToPocket) * 0.06));
            chosenCutCos = cutCos;
          }
        }
      }

      const cutDifficultyFactor = chosenCutCos < 0.7 ? 1.45 : 1.0;
      const humanAngleError = sampleGaussianError(
        levelInfo.aiErrorSigmaRad * cutDifficultyFactor
      );
      const finalAngle = idealAngle + humanAngleError;
      const finalPower = Math.min(
        95,
        Math.max(38, Math.round(idealPower + (Math.random() - 0.5) * 12))
      );

      const startAngle = aimAngle;
      const deltaAngle = Math.atan2(
        Math.sin(finalAngle - startAngle),
        Math.cos(finalAngle - startAngle)
      );
      const totalSweepSteps = 14;
      let sweepStep = 0;

      const sweepInterval = setInterval(() => {
        sweepStep++;
        if (sweepStep <= 10) {
          const t = sweepStep / 10;
          const ease = t < 0.8 ? (t / 0.8) * 1.06 : 1.06 - ((t - 0.8) / 0.2) * 0.06;
          setAimAngle(startAngle + deltaAngle * ease);
          setShotPower(Math.round(35 + (finalPower - 35) * t));
        } else if (sweepStep === 11) {
          setHumanThoughtText("Pulling back cue stick tray...");
          setAimAngle(finalAngle);
          setShotPower(finalPower);
        } else if (sweepStep >= totalSweepSteps) {
          clearInterval(sweepInterval);
          setIsOpponentAiming(false);
          setHumanThoughtText("");
          executeShot(finalAngle, finalPower, "opponent");
        }
      }, 115);

      return () => clearInterval(sweepInterval);
    }
  }, [
    mode,
    state.turn,
    state.winner,
    isSimulating,
    isOpponentAiming,
    aimAngle,
    levelInfo.aiErrorSigmaRad,
    executeShot,
  ]);

  // Convert client pointer to SVG felt coordinates (accounting for 90deg forcedLandscape)
  const clientToSvgCoords = (clientX: number, clientY: number) => {
    if (!svgRef.current) return { svgX: 205, svgY: TABLE_H / 2 };
    const rect = svgRef.current.getBoundingClientRect();
    if (forcedLandscape && isPortraitViewport) {
      const relX = (clientY - rect.top) / Math.max(1, rect.height);
      const relY = 1 - (clientX - rect.left) / Math.max(1, rect.width);
      return { svgX: relX * TABLE_W, svgY: relY * TABLE_H };
    }
    const relX = (clientX - rect.left) / Math.max(1, rect.width);
    const relY = (clientY - rect.top) / Math.max(1, rect.height);
    return { svgX: relX * TABLE_W, svgY: relY * TABLE_H };
  };

  // Pointer aiming OR Ball-in-Hand placement on the SVG pool table
  const handleTablePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isMyTurn) return;
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue || cue.potted) return;

    const { svgX, svgY } = clientToSvgCoords(e.clientX, e.clientY);

    // If Ball-in-Hand is active and user touches near the cue ball, let them drag & place it!
    if (state.ballInHand && Math.hypot(svgX - cue.x, svgY - cue.y) <= BALL_R * 2.8) {
      setIsDraggingCueBall(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const angle = Math.atan2(svgY - cue.y, svgX - cue.x);
    setAimAngle(angle);
  };

  const handleTablePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isMyTurn) return;
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue || cue.potted) return;

    const { svgX, svgY } = clientToSvgCoords(e.clientX, e.clientY);

    if (isDraggingCueBall && state.ballInHand) {
      const maxX = state.shotCount === 0 ? 205 : TABLE_W - BALL_R - 14;
      const clampedX = Math.max(BALL_R + 14, Math.min(maxX, svgX));
      const clampedY = Math.max(BALL_R + 14, Math.min(TABLE_H - BALL_R - 14, svgY));

      // Ensure cue ball doesn't overlap another ball
      const overlapsOther = state.balls.some(
        (b) => b.id !== 0 && !b.potted && Math.hypot(b.x - clampedX, b.y - clampedY) < BALL_R * 2.1
      );
      if (!overlapsOther) {
        setState((prev) => ({
          ...prev,
          balls: prev.balls.map((b) =>
            b.id === 0 ? { ...b, x: Number(clampedX.toFixed(1)), y: Number(clampedY.toFixed(1)) } : b
          ),
        }));
      }
      return;
    }

    if (e.buttons === 1) {
      const angle = Math.atan2(svgY - cue.y, svgX - cue.x);
      setAimAngle(angle);
    }
  };

  const handleTablePointerUp = () => {
    if (isDraggingCueBall) {
      setIsDraggingCueBall(false);
    }
  };

  const cueBall = state.balls.find((b) => b.id === 0 && !b.potted) || {
    id: 0,
    x: 205,
    y: TABLE_H / 2,
    vx: 0,
    vy: 0,
    potted: false,
  };

  const computeLaserPreview = () => {
    const dirX = Math.cos(aimAngle);
    const dirY = Math.sin(aimAngle);
    let closestDist = 900;
    let hitBall: PoolBall | null = null;

    if (dirX > 0.001) closestDist = Math.min(closestDist, (TABLE_W - BALL_R - 6 - cueBall.x) / dirX);
    if (dirX < -0.001) closestDist = Math.min(closestDist, (BALL_R + 6 - cueBall.x) / dirX);
    if (dirY > 0.001) closestDist = Math.min(closestDist, (TABLE_H - BALL_R - 6 - cueBall.y) / dirY);
    if (dirY < -0.001) closestDist = Math.min(closestDist, (BALL_R + 6 - cueBall.y) / dirY);

    for (const b of state.balls) {
      if (b.potted || b.id === 0) continue;
      const ocX = b.x - cueBall.x;
      const ocY = b.y - cueBall.y;
      const proj = ocX * dirX + ocY * dirY;
      if (proj <= 0) continue;
      const perpSq = ocX * ocX + ocY * ocY - proj * proj;
      const hitR = BALL_R * 1.98;
      if (perpSq < hitR * hitR) {
        const hitDist = proj - Math.sqrt(hitR * hitR - perpSq);
        if (hitDist > 0 && hitDist < closestDist) {
          closestDist = hitDist;
          hitBall = b;
        }
      }
    }

    const endX = cueBall.x + dirX * closestDist;
    const endY = cueBall.y + dirY * closestDist;

    let targetDeflectEnd: { x: number; y: number } | null = null;
    if (hitBall) {
      const nx = hitBall.x - endX;
      const ny = hitBall.y - endY;
      const nLen = Math.hypot(nx, ny) || 1;
      targetDeflectEnd = {
        x: hitBall.x + (nx / nLen) * 85,
        y: hitBall.y + (ny / nLen) * 85,
      };
    }

    return { endX, endY, hitBall, targetDeflectEnd };
  };

  const laser = computeLaserPreview();
  const showCueAndLaser = (isMyTurn || isOpponentAiming) && !cueBall.potted && !isSimulating;

  const creatorTargetIds =
    state.creatorGroup === "stripes"
      ? [9, 10, 11, 12, 13, 14, 15]
      : [1, 2, 3, 4, 5, 6, 7];
  const opponentTargetIds =
    state.opponentGroup === "solids"
      ? [1, 2, 3, 4, 5, 6, 7]
      : [9, 10, 11, 12, 13, 14, 15];

  const pottedBallsList = state.balls.filter((b) => b.potted && b.id !== 0);
  const angleDegreesDisplay = (((aimAngle * 180) / Math.PI + 360) % 360).toFixed(1);

  return (
    <div className="space-y-3">
      {/* ── STRICT PORTRAIT MODE LOCK OVERLAY (Requires Landscape View to Play!) ── */}
      {isPortraitViewport && !forcedLandscape ? (
        <div className="rounded-3xl bg-gradient-to-b from-[#0f172a] via-[#111c38] to-[#090d1a] border-2 border-amber-400/70 p-6 sm:p-8 text-center space-y-5 shadow-[0_25px_70px_rgba(0,0,0,0.9)]">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(245,158,11,0.5)]">
            <Smartphone className="w-11 h-11 -rotate-90 animate-bounce" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <Badge className="bg-rose-500/20 text-rose-300 border border-rose-400/50 font-black text-xs px-3 py-1">
              🔒 PORTRAIT MODE RESTRICTED
            </Badge>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              Turn Your Phone Sideways to Play 8-Ball Pool Pro!
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              To give you full control over the <strong>Left Fine-Aiming Stick Tray</strong>, the{" "}
              <strong>Right Pull-Back Cue Stick Sleeve</strong>, and the{" "}
              <strong>Championship Blue Felt Table</strong>, 8-Ball Pool is locked to{" "}
              <strong className="text-amber-300">Landscape Mode</strong>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              type="button"
              onClick={handleEnterLandscapeMode}
              className="w-full sm:w-auto h-12 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-sm gap-2 shadow-xl"
            >
              <Maximize2 className="w-4 h-4" />
              Switch to Fullscreen Landscape Now
            </Button>
          </div>

          <p className="text-[11px] text-slate-400">
            💡 Physically rotate your phone horizontally (auto-unlocks) or tap the button above if your rotation lock is on!
          </p>
        </div>
      ) : (
        /* ── Main 8-Ball Pool Landscape Studio Stage ── */
        <div
          className={
            forcedLandscape && isPortraitViewport
              ? "fixed inset-0 z-[90] bg-[#0b1324] flex items-center justify-center overflow-hidden"
              : "relative rounded-3xl bg-gradient-to-b from-[#131e36] via-[#0d1629] to-[#090f1d] border-2 border-sky-500/30 p-3 sm:p-5 shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden"
          }
        >
          <div
            style={
              forcedLandscape && isPortraitViewport
                ? {
                    width: "100vh",
                    height: "100vw",
                    transform: "rotate(90deg)",
                    transformOrigin: "center center",
                  }
                : undefined
            }
            className={
              forcedLandscape && isPortraitViewport
                ? "p-2.5 flex flex-col justify-between bg-gradient-to-b from-[#131e36] to-[#090f1d]"
                : "space-y-3"
            }
          >
            {/* ── Animated Next Player's Turn Notification Spotlight Banner ── */}
            {turnBanner && (
              <div
                className={`px-4 py-2 rounded-2xl border-2 flex items-center justify-between gap-3 animate-in slide-in-from-top-3 duration-200 shadow-xl ${
                  turnBanner.isMe
                    ? "bg-gradient-to-r from-emerald-950/95 via-teal-900/90 to-slate-950 border-emerald-400 text-white"
                    : "bg-gradient-to-r from-amber-950/95 via-orange-950/90 to-slate-950 border-amber-400 text-white"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                      turnBanner.isMe
                        ? "bg-emerald-400 text-slate-950 animate-bounce"
                        : "bg-amber-400 text-slate-950"
                    }`}
                  >
                    <BellRing className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm font-black tracking-wide">
                      {turnBanner.isMe
                        ? `🟢 YOUR TURN TO SHOOT, ${turnBanner.playerName.toUpperCase()}!`
                        : `🔔 NEXT PLAYER'S TURN: ${turnBanner.playerName.toUpperCase()} IS UP!`}
                    </p>
                    <p className="text-[10px] sm:text-xs text-slate-200 line-clamp-1">
                      {turnBanner.subtitle}
                    </p>
                  </div>
                </div>
                <Badge
                  className={
                    turnBanner.isMe
                      ? "bg-emerald-400 text-slate-950 font-black text-[10px]"
                      : "bg-amber-400 text-slate-950 font-black text-[10px]"
                  }
                >
                  {turnBanner.isMe ? "Aim & Pull Stick" : "Opponent Turn"}
                </Badge>
              </div>
            )}

            {/* ── Top Tournament HUD Bar ── */}
            <div className="flex items-center justify-between gap-2 px-1 sm:px-2">
              {/* Left Player (Creator / ZEE) + 7 Target Ball Slots */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div
                  className={`relative px-2.5 py-1.5 rounded-xl border-2 flex items-center gap-2 transition-all ${
                    state.turn === "creator"
                      ? "bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                      : "bg-slate-900/80 border-amber-500/40 opacity-80"
                  }`}
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 font-black text-xs">
                    {creatorName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="leading-tight">
                    <p className="text-[11px] sm:text-xs font-black text-white truncate max-w-[90px]">
                      {creatorName}
                    </p>
                    <p className="text-[9px] font-extrabold uppercase text-emerald-300">
                      {state.creatorGroup ? state.creatorGroup.toUpperCase() : "OPEN TABLE"}
                    </p>
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-1">
                  {creatorTargetIds.map((ballId) => {
                    const ballObj = state.balls.find((b) => b.id === ballId);
                    const isRemaining = ballObj && !ballObj.potted;
                    const meta = BALL_COLORS[ballId];
                    return (
                      <div
                        key={ballId}
                        className={`w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-black transition-all ${
                          state.creatorGroup && isRemaining
                            ? "border-white/40 shadow-inner"
                            : "border-white/15 bg-slate-900/50 text-slate-600"
                        }`}
                        style={
                          state.creatorGroup && isRemaining
                            ? {
                                background: meta.stripe
                                  ? `linear-gradient(180deg, #fff 22%, ${meta.main} 22%, ${meta.main} 78%, #fff 78%)`
                                  : meta.main,
                                color: "#ffffff",
                              }
                            : undefined
                        }
                      >
                        {state.creatorGroup && isRemaining ? ballId : ""}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Center Turn / Sensory Controls & Motion Sensor Badge */}
              <div className="flex flex-col items-center text-center">
                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  <Badge
                    className={
                      isMyTurn
                        ? "bg-emerald-500 text-slate-950 font-black text-[10px] px-2.5 py-0.5 animate-pulse"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[10px] px-2.5 py-0.5"
                    }
                  >
                    {state.winner
                      ? `🏆 ${state.winner === "creator" ? creatorName : displayOpponentName} WINS!`
                      : isSimulating
                      ? "🎱 BALLS IN MOTION..."
                      : isMyTurn
                      ? state.ballInHand
                        ? "✋ BALL IN HAND — DRAG CUE BALL OR AIM"
                        : "⚡ YOUR TURN — ADJUST TRAY & PULL CUE"
                      : `⏳ NEXT TURN: ${displayOpponentName.split(" ")[0]}`}
                  </Badge>

                  {/* Motion Sensor Tilt Aim Toggle */}
                  <button
                    type="button"
                    onClick={toggleMotionSensor}
                    title="Toggle Phone Gyroscope / Motion Sensor Fine-Aim"
                    className={`px-2 py-1 rounded-lg border text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer ${
                      motionSensorActive
                        ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
                        : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                    }`}
                  >
                    <Compass className={`w-3.5 h-3.5 ${motionSensorActive ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">
                      {motionSensorActive ? `Gyro ${tiltDegrees > 0 ? `+${tiltDegrees}°` : `${tiltDegrees}°`}` : "Gyro Aim"}
                    </span>
                  </button>

                  {/* Sound Toggle */}
                  <button
                    type="button"
                    onClick={handleToggleSound}
                    title={soundOn ? "Mute Billiard Audio" : "Unmute Billiard Audio"}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      soundOn
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-white/5 border-white/10 text-slate-500"
                    }`}
                  >
                    {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  </button>

                  {/* Haptic Vibration Sensor Toggle */}
                  <button
                    type="button"
                    onClick={handleToggleVibe}
                    title={vibeOn ? "Vibration Sensor Active" : "Vibration Sensor Off"}
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                      vibeOn
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                        : "bg-white/5 border-white/10 text-slate-500"
                    }`}
                  >
                    <Vibrate className="w-3.5 h-3.5" />
                  </button>

                  {/* Fullscreen Landscape Toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      forcedLandscape ? setForcedLandscape(false) : handleEnterLandscapeMode()
                    }
                    title="Toggle Fullscreen Landscape Table"
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-sky-300 hover:text-white transition-colors cursor-pointer"
                  >
                    {forcedLandscape ? (
                      <Minimize2 className="w-3.5 h-3.5" />
                    ) : (
                      <Maximize2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-slate-300 line-clamp-1 max-w-[260px] sm:max-w-md mt-0.5">
                  {isOpponentAiming && humanThoughtText ? `💭 ${humanThoughtText}` : state.lastAction}
                </p>
              </div>

              {/* Right Player (Opponent) + 7 Target Ball Slots */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden md:flex items-center gap-1">
                  {opponentTargetIds.map((ballId) => {
                    const ballObj = state.balls.find((b) => b.id === ballId);
                    const isRemaining = ballObj && !ballObj.potted;
                    const meta = BALL_COLORS[ballId];
                    return (
                      <div
                        key={ballId}
                        className={`w-5 h-5 rounded-full border flex items-center justify-center text-[8px] font-black transition-all ${
                          state.opponentGroup && isRemaining
                            ? "border-white/40 shadow-inner"
                            : "border-white/15 bg-slate-900/50 text-slate-600"
                        }`}
                        style={
                          state.opponentGroup && isRemaining
                            ? {
                                background: meta.stripe
                                  ? `linear-gradient(180deg, #fff 22%, ${meta.main} 22%, ${meta.main} 78%, #fff 78%)`
                                  : meta.main,
                                color: "#ffffff",
                              }
                            : undefined
                        }
                      >
                        {state.opponentGroup && isRemaining ? ballId : ""}
                      </div>
                    );
                  })}
                </div>

                <div
                  className={`relative px-2.5 py-1.5 rounded-xl border-2 flex items-center gap-2 transition-all ${
                    state.turn === "opponent"
                      ? "bg-amber-950/80 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                      : "bg-slate-900/80 border-amber-500/40 opacity-80"
                  }`}
                >
                  <div className="leading-tight text-right">
                    <p className="text-[11px] sm:text-xs font-black text-white truncate max-w-[110px]">
                      {displayOpponentName}
                    </p>
                    <p className="text-[9px] font-extrabold uppercase text-amber-300 flex items-center justify-end gap-1">
                      {mode !== "p2p" && <Brain className="w-2.5 h-2.5 text-emerald-400" />}
                      {state.opponentGroup
                        ? state.opponentGroup.toUpperCase()
                        : mode !== "p2p"
                        ? `${levelInfo.humanSensePercent}% HUMAN SENSE`
                        : "OPEN TABLE"}
                    </p>
                  </div>
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-slate-950 font-black text-xs">
                    {mode !== "p2p"
                      ? levelInfo.persona.avatarInitials
                      : displayOpponentName.slice(0, 2).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Main Horizontal Arena Row: Left Stick Fine-Aim Tray & Ball Return | Center Table | Right Cue-Stick Pull-Back Tray ── */}
            <div className="flex items-stretch gap-2 sm:gap-3">
              {/* LEFT SIDE DOCK: Cue Spin Globe + Chrome Ball Return + Interactive Fine-Aiming Stick Tray (Matches Reference Photo!) */}
              <div className="flex flex-col items-center justify-between w-14 sm:w-16 py-0.5 shrink-0 gap-1.5 select-none">
                {/* 1. Cue Ball Spin (English) Selector */}
                <button
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() =>
                    setSpinOffset((prev) => ({
                      x: prev.x === 0 ? 4 : prev.x === 4 ? -4 : 0,
                      y: prev.y === 0 ? -4 : prev.y === -4 ? 4 : 0,
                    }))
                  }
                  title="Cue Ball Spin (Tap to cycle Top/Back/Side English)"
                  className="w-10 h-10 rounded-full bg-gradient-to-br from-white via-slate-100 to-slate-300 border-2 border-slate-400 shadow-lg flex items-center justify-center relative cursor-pointer disabled:opacity-50"
                >
                  <span className="absolute inset-1.5 rounded-full border border-dashed border-slate-400/60" />
                  <span
                    className="w-2.5 h-2.5 rounded-full bg-rose-600 shadow-sm transition-transform"
                    style={{
                      transform: `translate(${spinOffset.x}px, ${spinOffset.y}px)`,
                    }}
                  />
                </button>

                {/* 2. Interactive Fine-Aiming Wheel Tray (Drag Up/Down to Micro-Adjust Pool Stick Angle!) */}
                <div className="flex-1 w-full flex flex-col items-center">
                  <div className="flex items-center justify-between w-full px-0.5 mb-0.5">
                    <button
                      type="button"
                      disabled={!isMyTurn}
                      onClick={() => adjustStickAngleByDelta(-0.006, -4)}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-black text-amber-300 border border-white/10 cursor-pointer disabled:opacity-40"
                      title="Micro-rotate stick counter-clockwise (-0.3°)"
                    >
                      ▲
                    </button>
                    <span className="text-[8px] font-mono font-black text-sky-300">
                      {angleDegreesDisplay}°
                    </span>
                    <button
                      type="button"
                      disabled={!isMyTurn}
                      onClick={() => adjustStickAngleByDelta(0.006, 4)}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[9px] font-black text-amber-300 border border-white/10 cursor-pointer disabled:opacity-40"
                      title="Micro-rotate stick clockwise (+0.3°)"
                    >
                      ▼
                    </button>
                  </div>

                  <div
                    ref={fineTrayRef}
                    onPointerDown={handleFineTrayPointerDown}
                    onPointerMove={handleFineTrayPointerMove}
                    onPointerUp={handleFineTrayPointerUp}
                    onPointerCancel={handleFineTrayPointerUp}
                    onWheel={(e) => {
                      if (!isMyTurn) return;
                      adjustStickAngleByDelta(e.deltaY * 0.0005, e.deltaY * 0.15);
                    }}
                    title="Drag Up/Down to Fine-Tune Pool Stick Aim!"
                    className={`relative flex-1 w-12 sm:w-13 rounded-xl bg-gradient-to-r from-slate-300 via-white to-slate-300 border-2 ${
                      isMyTurn
                        ? "border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.35)] cursor-ns-resize"
                        : "border-slate-600 opacity-60 cursor-default"
                    } overflow-hidden flex flex-col justify-between py-1 touch-none`}
                  >
                    {/* 3-Rail Chrome Pipe Border Accents */}
                    <div className="absolute inset-y-0 left-1 w-0.5 bg-slate-400/70 pointer-events-none" />
                    <div className="absolute inset-y-0 right-1 w-0.5 bg-slate-400/70 pointer-events-none" />

                    {/* Animated Scrolling Horizontal Ruler Ticks (Exact match to bottom-left tray in reference screenshot) */}
                    <div
                      className="w-full h-full flex flex-col justify-around items-center pointer-events-none"
                      style={{
                        transform: `translateY(${fineWheelOffset * 0.45}px)`,
                      }}
                    >
                      {Array.from({ length: 14 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-[2px] rounded-full ${
                            i % 3 === 0 ? "w-8 bg-slate-800" : "w-5 bg-slate-500/80"
                          }`}
                        />
                      ))}
                    </div>

                    {/* Center Red Hairline Indicator */}
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2.5px] bg-rose-600 shadow pointer-events-none" />
                    <div className="absolute bottom-1 inset-x-0 text-center pointer-events-none">
                      <span className="px-1 py-0.5 rounded bg-slate-950/85 text-[7px] font-black text-amber-300 uppercase tracking-tighter">
                        AIM TRAY
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Compact Potted Ball Return Window */}
                <div className="w-12 h-14 rounded-xl bg-slate-950/90 border border-slate-600/70 p-1 flex flex-wrap items-center justify-center gap-0.5 overflow-hidden shadow-inner">
                  {pottedBallsList.length === 0 ? (
                    <span className="text-[7px] font-bold text-slate-500 text-center leading-tight">
                      POTTED
                      <br />
                      RACK
                    </span>
                  ) : (
                    pottedBallsList.slice(-6).map((b) => {
                      const meta = BALL_COLORS[b.id];
                      return (
                        <div
                          key={b.id}
                          className="w-4 h-4 rounded-full border border-white/30 flex items-center justify-center text-[6px] font-black text-white shadow"
                          style={{
                            background: meta.stripe
                              ? `linear-gradient(180deg, #fff 22%, ${meta.main} 22%, ${meta.main} 78%, #fff 78%)`
                              : meta.main,
                          }}
                        >
                          {b.id}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* CENTER 8-BALL POOL TABLE */}
              <div
                style={
                  motionSensorActive
                    ? {
                        transform: `perspective(900px) rotateY(${parallaxOffset.x * 0.35}deg) rotateX(${-parallaxOffset.y * 0.35}deg)`,
                        transition: "transform 120ms ease-out",
                      }
                    : undefined
                }
                className="flex-1 relative rounded-[26px] p-3 sm:p-5 bg-gradient-to-b from-[#9c421a] via-[#6e2a0c] to-[#4a1a06] border-4 border-[#381204] shadow-[0_20px_50px_rgba(0,0,0,0.9),inset_0_2px_6px_rgba(255,255,255,0.25)] select-none"
              >
                {/* Floating Live Points Earned Banner */}
                {floatingRewardText && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-400 text-slate-950 font-black text-xs shadow-[0_10px_30px_rgba(245,158,11,0.6)] animate-bounce pointer-events-none">
                    {floatingRewardText}
                  </div>
                )}

                {/* Silver / Chrome Corner & Center Pocket Castings */}
                <div className="absolute top-0 left-0 w-9 h-9 rounded-tl-[22px] rounded-br-2xl bg-gradient-to-br from-slate-200 via-slate-400 to-slate-700 border-b border-r border-slate-900 pointer-events-none" />
                <div className="absolute top-0 right-0 w-9 h-9 rounded-tr-[22px] rounded-bl-2xl bg-gradient-to-bl from-slate-200 via-slate-400 to-slate-700 border-b border-l border-slate-900 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-9 h-9 rounded-bl-[22px] rounded-tr-2xl bg-gradient-to-tr from-slate-200 via-slate-400 to-slate-700 border-t border-r border-slate-900 pointer-events-none" />
                <div className="absolute bottom-0 right-0 w-9 h-9 rounded-br-[22px] rounded-tl-2xl bg-gradient-to-tl from-slate-200 via-slate-400 to-slate-700 border-t border-l border-slate-900 pointer-events-none" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-4 rounded-b-lg bg-gradient-to-b from-slate-200 via-slate-400 to-slate-700 pointer-events-none" />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-4 rounded-t-lg bg-gradient-to-t from-slate-200 via-slate-400 to-slate-700 pointer-events-none" />

                {/* Interactive SVG Tournament Blue Felt Surface */}
                <div className="relative rounded-xl overflow-hidden border-[5px] border-[#114b7a] shadow-[inset_0_0_35px_rgba(0,0,0,0.65)]">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${TABLE_W} ${TABLE_H}`}
                    onPointerDown={handleTablePointerDown}
                    onPointerMove={handleTablePointerMove}
                    onPointerUp={handleTablePointerUp}
                    onPointerCancel={handleTablePointerUp}
                    className="w-full h-auto block touch-none cursor-crosshair"
                  >
                    <defs>
                      <radialGradient id="poolFeltBlue" cx="50%" cy="50%" r="65%">
                        <stop offset="0%" stopColor="#2ca2ec" />
                        <stop offset="65%" stopColor="#1d7ec2" />
                        <stop offset="100%" stopColor="#12558a" />
                      </radialGradient>
                      <radialGradient id="ballHighlight" cx="32%" cy="30%" r="55%">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
                        <stop offset="45%" stopColor="rgba(255,255,255,0.08)" />
                        <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
                      </radialGradient>
                    </defs>

                    <rect x={0} y={0} width={TABLE_W} height={TABLE_H} fill="url(#poolFeltBlue)" />

                    {/* Baulk Line & Foot Spot */}
                    <line
                      x1={205}
                      y1={0}
                      x2={205}
                      y2={TABLE_H}
                      stroke="rgba(255,255,255,0.22)"
                      strokeWidth={1.5}
                    />
                    <line
                      x1={550}
                      y1={0}
                      x2={550}
                      y2={TABLE_H}
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={1}
                    />
                    <circle cx={550} cy={TABLE_H / 2} r={3.5} fill="rgba(15,23,42,0.55)" />

                    {/* 6 Deep Black Pockets */}
                    {POCKETS.map((p, idx) => (
                      <g key={idx}>
                        <circle cx={p.x} cy={p.y} r={POCKET_R + 3} fill="#0f172a" opacity={0.45} />
                        <circle cx={p.x} cy={p.y} r={POCKET_R} fill="#04070d" />
                      </g>
                    ))}

                    {/* Glowing Laser Aiming Guideline + Cue Stick */}
                    {showCueAndLaser && (
                      <g>
                        <line
                          x1={cueBall.x}
                          y1={cueBall.y}
                          x2={laser.endX}
                          y2={laser.endY}
                          stroke={isOpponentAiming ? "rgba(251,191,36,0.32)" : "rgba(224,242,254,0.38)"}
                          strokeWidth={BALL_R * 1.55}
                          strokeLinecap="round"
                        />
                        <line
                          x1={cueBall.x}
                          y1={cueBall.y}
                          x2={laser.endX}
                          y2={laser.endY}
                          stroke={isOpponentAiming ? "#fde047" : "#ffffff"}
                          strokeWidth={2.5}
                        />

                        <circle
                          cx={laser.endX}
                          cy={laser.endY}
                          r={BALL_R}
                          fill="rgba(255,255,255,0.18)"
                          stroke={isOpponentAiming ? "#fde047" : "#ffffff"}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                        />

                        {laser.targetDeflectEnd && laser.hitBall && (
                          <line
                            x1={laser.hitBall.x}
                            y1={laser.hitBall.y}
                            x2={laser.targetDeflectEnd.x}
                            y2={laser.targetDeflectEnd.y}
                            stroke="#fde047"
                            strokeWidth={2.5}
                            strokeDasharray="5 4"
                          />
                        )}

                        {(() => {
                          const pullBack = 16 + (shotPower / 100) * 44;
                          const tipX = cueBall.x - Math.cos(aimAngle) * pullBack;
                          const tipY = cueBall.y - Math.sin(aimAngle) * pullBack;
                          const buttX = cueBall.x - Math.cos(aimAngle) * (pullBack + 215);
                          const buttY = cueBall.y - Math.sin(aimAngle) * (pullBack + 215);
                          const midX = cueBall.x - Math.cos(aimAngle) * (pullBack + 98);
                          const midY = cueBall.y - Math.sin(aimAngle) * (pullBack + 98);

                          return (
                            <g>
                              <line
                                x1={buttX}
                                y1={buttY + 5}
                                x2={tipX}
                                y2={tipY + 5}
                                stroke="rgba(0,0,0,0.45)"
                                strokeWidth={8}
                                strokeLinecap="round"
                              />
                              <line
                                x1={buttX}
                                y1={buttY}
                                x2={midX}
                                y2={midY}
                                stroke="#1e1b18"
                                strokeWidth={8}
                                strokeLinecap="round"
                              />
                              <line
                                x1={midX}
                                y1={midY}
                                x2={tipX}
                                y2={tipY}
                                stroke="#e2e8f0"
                                strokeWidth={5.2}
                                strokeLinecap="round"
                              />
                              <circle cx={tipX} cy={tipY} r={3.2} fill="#0284c7" />
                            </g>
                          );
                        })()}
                      </g>
                    )}

                    {/* Render All Active Pool Balls (0..15) */}
                    {state.balls.map((b) => {
                      if (b.potted) return null;
                      const meta = BALL_COLORS[b.id] || BALL_COLORS[1];
                      const isCueWithBallInHand = b.id === 0 && isMyTurn && state.ballInHand;
                      return (
                        <g key={b.id} transform={`translate(${b.x}, ${b.y})`}>
                          {isCueWithBallInHand && (
                            <circle
                              cx={0}
                              cy={0}
                              r={BALL_R + 6}
                              fill="none"
                              stroke="#38bdf8"
                              strokeWidth={2}
                              strokeDasharray="4 3"
                            />
                          )}
                          <circle cx={2.5} cy={3.5} r={BALL_R} fill="rgba(0,0,0,0.42)" />
                          <circle
                            cx={0}
                            cy={0}
                            r={BALL_R}
                            fill={meta.stripe ? "#f8fafc" : meta.main}
                          />
                          {meta.stripe && (
                            <rect
                              x={-BALL_R + 1}
                              y={-BALL_R * 0.52}
                              width={BALL_R * 2 - 2}
                              height={BALL_R * 1.04}
                              rx={4}
                              fill={meta.main}
                            />
                          )}
                          {b.id === 0 ? (
                            <circle cx={3} cy={-2} r={2.3} fill="#dc2626" />
                          ) : (
                            <>
                              <circle cx={0} cy={0} r={5.6} fill="#ffffff" opacity={0.95} />
                              <text
                                x={0}
                                y={2.8}
                                textAnchor="middle"
                                fontSize="7.5"
                                fontWeight="900"
                                fill="#0f172a"
                              >
                                {b.id}
                              </text>
                            </>
                          )}
                          <circle cx={0} cy={0} r={BALL_R} fill="url(#ballHighlight)" />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* RIGHT SIDE DOCK: Tapered Cue-Stick Pull-Back Sleeve Tray & Shoot Trigger (Matches Reference Photo!) */}
              <div className="flex flex-col items-center justify-between w-16 sm:w-20 py-0.5 shrink-0 gap-1.5 select-none">
                <div className="text-center leading-tight">
                  <p className="text-[8px] font-black uppercase tracking-wider text-sky-300">
                    CUE TRAY
                  </p>
                  <p className="text-xs font-black font-mono text-amber-400">{shotPower}%</p>
                </div>

                {/* Interactive Pull-Back Cue Stick Sleeve (Drag Down & Release to Strike!) */}
                <div
                  ref={powerTrayRef}
                  onPointerDown={handlePowerTrayPointerDown}
                  onPointerMove={handlePowerTrayPointerMove}
                  onPointerUp={handlePowerTrayPointerUp}
                  onPointerCancel={handlePowerTrayPointerUp}
                  title="Drag down to pull back Pool Stick & release to shoot!"
                  className={`relative flex-1 w-12 sm:w-14 rounded-2xl bg-gradient-to-b from-slate-900 via-slate-950 to-black border-2 ${
                    isMyTurn
                      ? "border-sky-400/80 shadow-[0_0_15px_rgba(56,189,248,0.3)] cursor-ns-resize"
                      : "border-slate-700 opacity-60 cursor-default"
                  } p-1.5 flex flex-col justify-between overflow-hidden touch-none`}
                >
                  {/* Top Chrome Collar (Matches right-side tray in reference screenshot) */}
                  <div className="w-full h-3 rounded-sm bg-gradient-to-r from-slate-300 via-white to-slate-400 border border-slate-800 shadow z-10 pointer-events-none" />

                  {/* Background Power Fill Glow */}
                  <div
                    className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-emerald-500/35 via-amber-400/45 to-rose-500/55 transition-all pointer-events-none"
                    style={{ height: `${shotPower}%` }}
                  />

                  {/* Miniature Sliding Pool Cue Stick inside the Right Tray */}
                  <div
                    className="relative z-10 mx-auto w-3.5 h-full flex flex-col items-center pointer-events-none transition-transform duration-75"
                    style={{
                      transform: `translateY(${Math.round((shotPower / 100) * 52)}px)`,
                    }}
                  >
                    {/* Blue Chalk Tip */}
                    <div className="w-2.5 h-2 rounded-t-sm bg-sky-400 border-b border-white" />
                    {/* Maple Shaft */}
                    <div className="w-2.5 h-16 bg-gradient-to-r from-amber-100 via-white to-amber-200" />
                    {/* Ebony & Gold Butt Handle */}
                    <div className="w-3.5 flex-1 rounded-b-md bg-gradient-to-b from-amber-600 via-stone-900 to-black border border-amber-500/40" />
                  </div>

                  <div className="relative z-20 text-center pointer-events-none">
                    <span className="px-1 py-0.5 rounded bg-black/80 text-[7px] font-black text-amber-300 uppercase">
                      {isPullingPowerTray ? "RELEASE!" : "PULL CUE"}
                    </span>
                  </div>
                </div>

                {/* Instant Shoot Button (Alternative to Drag-and-Release) */}
                <Button
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() => executeShot(aimAngle, shotPower, state.turn)}
                  className="w-full h-10 rounded-xl bg-gradient-to-b from-amber-400 via-orange-500 to-amber-600 hover:from-amber-300 hover:to-orange-500 text-slate-950 font-black text-[11px] shadow-lg px-1"
                >
                  <Zap className="w-3.5 h-3.5 mr-0.5 shrink-0" />
                  SHOOT
                </Button>
              </div>
            </div>

            {/* ── Bottom Quick Controls & Sensory Status Bar ── */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-300">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-bold text-amber-300">
                  <Crosshair className="w-3.5 h-3.5" /> Drag <strong>Left Aim Tray</strong> for fine stick angle • Drag <strong>Right Cue Tray</strong> down &amp; release to shoot!
                </span>
                {state.ballInHand && isMyTurn && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/40 font-black text-sky-300">
                    <Hand className="w-3.5 h-3.5" /> Ball-in-Hand: Drag white cue ball anywhere on table
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-bold text-emerald-300">
                  <Sparkles className="w-3.5 h-3.5" /> +40 Pts/ball • +300 Pts/win
                </span>
              </div>

              {state.winner && mode !== "p2p" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const fresh: EightBallPoolState = {
                      ...INITIAL_POOL_STATE,
                      balls: createInitialPoolBalls(),
                    };
                    setState(fresh);
                    onStateChange?.(fresh);
                  }}
                  className="h-8 rounded-xl border-amber-500/40 text-amber-300 text-xs font-bold gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Next Frame (Keep Accumulating Points)
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EightBallPoolBoard;
