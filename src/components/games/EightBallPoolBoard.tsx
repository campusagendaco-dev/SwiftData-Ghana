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
} from "lucide-react";
import {
  playCueStrikeSound,
  playBallClackSound,
  playRailBounceSound,
  playPocketDropSound,
  playFoulAlertSound,
  playLevelUpFanfare,
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
  "Checking cut angle on target ball...",
  "Lining up cue stick & chalking tip...",
  "Measuring cue ball position...",
  "Dialing in medium stroke power...",
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
  winner: null,
  lastAction: "Break Shot! Aim with touch or Motion Sensor and pull power to break the rack!",
  shotCount: 0,
};

function isBallInGroup(id: number, group: "solids" | "stripes" | null): boolean {
  if (!group) return id >= 1 && id <= 15 && id !== 8;
  if (group === "solids") return id >= 1 && id <= 7;
  return id >= 9 && id <= 15;
}

interface EightBallPoolBoardProps {
  mode: "p2p" | "ai" | "free_data";
  mySide: "creator" | "opponent";
  creatorName: string;
  opponentName: string;
  playerTotalPoints?: number;
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
      ? opponentName
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
  const [shotPower, setShotPower] = useState<number>(76); // 15..100
  const [spinOffset, setSpinOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isOpponentAiming, setIsOpponentAiming] = useState<boolean>(false);
  const [humanThoughtText, setHumanThoughtText] = useState<string>("");
  const [potStreak, setPotStreak] = useState<number>(0);
  const [floatingRewardText, setFloatingRewardText] = useState<string | null>(null);

  // Sound, Vibration & Motion Sensor states
  const [soundOn, setSoundOn] = useState<boolean>(() => getGameSensoryPreferences().soundEnabled);
  const [vibeOn, setVibeOn] = useState<boolean>(() => getGameSensoryPreferences().vibrationEnabled);
  const [motionSensorActive, setMotionSensorActive] = useState<boolean>(false);
  const [tiltDegrees, setTiltDegrees] = useState<number>(0);
  const [parallaxOffset, setParallaxOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Landscape & Fullscreen state for mobile phones
  const [isPortraitMobile, setIsPortraitMobile] = useState<boolean>(false);
  const [forcedLandscape, setForcedLandscape] = useState<boolean>(false);
  const [dismissedRotatePrompt, setDismissedRotatePrompt] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const stateRef = useRef<EightBallPoolState>(state);
  stateRef.current = state;

  // Sync incoming multiplayer state when not actively animating a shot locally
  useEffect(() => {
    if (!isSimulating && initialState && Array.isArray(initialState.balls) && initialState.balls.length === 16) {
      setState((prev) => ({
        ...prev,
        ...initialState,
        balls: initialState.balls!,
      }));
    }
  }, [initialState, isSimulating]);

  // Detect portrait mobile orientation
  useEffect(() => {
    const checkOrientation = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsPortraitMobile(w < 768 && h > w);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
    };
  }, []);

  const isMyTurn =
    !state.winner &&
    !isSimulating &&
    !isOpponentAiming &&
    (mode === "p2p" ? state.turn === mySide : state.turn === "creator");

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
      // In landscape or portrait, combine gamma/beta tilt for intuitive fine-aim micro-steering
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

      // Micro-steer cue aim angle when player tilts phone beyond deadzone (1.5 deg)
      if (Math.abs(clampedTilt) > 1.5) {
        setAimAngle((prev) => prev + clampedTilt * 0.00045);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [motionSensorActive]);

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
      // Fallback to CSS 90deg landscape theatre mode
    }
    setForcedLandscape(true);
    setDismissedRotatePrompt(true);
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

      // Play initial leather cue-tip strike sound & haptic pulse!
      playCueStrikeSound(powerPercent);

      const maxSpeed = 23.5;
      const speed = Math.max(3.5, (powerPercent / 100) * maxSpeed);
      cue.vx = Math.cos(angleRad) * speed;
      cue.vy = Math.sin(angleRad) * speed;

      const pottedThisShot: number[] = [];
      let firstContactId: number | null = null;
      const frames: { balls: PoolBall[]; events: FrameAudioEvent[] }[] = [];
      let pendingEvents: FrameAudioEvent[] = [];

      // Run up to 480 physics steps
      for (let step = 0; step < 480; step++) {
        let moving = false;

        // 1. Advance positions & cushion bounces
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

          // Check pockets first
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

          // Rail cushion collisions
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

        // 2. Ball-to-Ball Elastic Collisions
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

              // Separate overlapping balls
              const overlap = (minDist - dist) / 2 + 0.05;
              const nx = dx / dist;
              const ny = dy / dist;
              b1.x -= nx * overlap;
              b1.y -= ny * overlap;
              b2.x += nx * overlap;
              b2.y += ny * overlap;

              // Elastic impulse along normal
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

        // Record every 2nd physics tick for smooth 60fps playback
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

      // Evaluate 8-Ball Pool rules after all balls come to rest
      let creatorGroup = current.creatorGroup;
      let opponentGroup = current.opponentGroup;
      const otherPlayer: "creator" | "opponent" = shooter === "creator" ? "opponent" : "creator";
      const shooterLabel = shooter === "creator" ? creatorName : displayOpponentName;

      const cueScratched = pottedThisShot.includes(0);
      const eightBallPotted = pottedThisShot.includes(8);

      // Re-spot cue ball if scratched
      if (cueScratched) {
        const cueBall = simBalls.find((b) => b.id === 0)!;
        cueBall.potted = false;
        cueBall.x = 195;
        cueBall.y = TABLE_H / 2 + (Math.random() * 40 - 20);
        cueBall.vx = 0;
        cueBall.vy = 0;
      }

      // Assign groups if table was still Open and a non-8 ball was legally potted
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
        actionSummary = `⚠️ Foul (Cue ball scratch)! Ball-in-hand for ${
          otherPlayer === "creator" ? creatorName : displayOpponentName
        }.`;
      } else {
        if (pottedOwnBalls.length > 0) {
          nextTurn = shooter; // Continues break!
          actionSummary = newlyAssigned
            ? `🔥 ${shooterLabel} potted Ball #${pottedOwnBalls[0]} and claimed ${activeShooterGroup?.toUpperCase()}! Extra shot!`
            : `🔥 ${shooterLabel} sank ${pottedOwnBalls.map((n) => `#${n}`).join(", ")}! Extra shot!`;
        } else if (pottedThisShot.length > 0) {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} potted opponent's ball (${pottedThisShot
            .map((n) => `#${n}`)
            .join(", ")}). Turn passes!`;
        } else if (firstContactId === null) {
          nextTurn = otherPlayer;
          actionSummary = `Foul — cue ball missed all object balls! Turn passes.`;
        } else {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} played a shot. Now it's ${
            otherPlayer === "creator" ? creatorName : displayOpponentName
          }'s turn!`;
        }
      }

      // Animate frames smoothly with real-time sound & haptic triggers
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

          // Fire acoustic & haptic events for this keyframe
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
            winner,
            lastAction: actionSummary,
            shotCount: current.shotCount + 1,
          };
          setState(finalState);
          setIsSimulating(false);
          setSpinOffset({ x: 0, y: 0 });

          // Award progression points to human player for potted balls & wins!
          const isHumanShot =
            (mode === "p2p" && shooter === mySide) ||
            (mode !== "p2p" && shooter === "creator");

          if (cueScratched && isHumanShot) {
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

  // ── Human-Sense Medium Opponent ("Kwame / Kojo / Nana") with Visible Cue Sweeping & Gaussian Error ──
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

      // Identify legal target balls for opponent
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

      // Evaluate candidate shots like a Medium-skill club player (1-shot horizon)
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

          // Human perception noise when comparing shots (so opponent picks natural club shots)
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

      // Apply Human Gaussian Error scaled by Level (Medium difficulty sweet spot!)
      // Steeper cuts (>40 deg) amplify human error naturally, just like real billiards!
      const cutDifficultyFactor = chosenCutCos < 0.7 ? 1.45 : 1.0;
      const humanAngleError = sampleGaussianError(
        levelInfo.aiErrorSigmaRad * cutDifficultyFactor
      );
      const finalAngle = idealAngle + humanAngleError;
      const finalPower = Math.min(
        95,
        Math.max(38, Math.round(idealPower + (Math.random() - 0.5) * 12))
      );

      // Visibly sweep the cue stick over 12 animation steps so the player sees the human opponent aiming!
      const startAngle = aimAngle;
      // Shortest angular distance
      const deltaAngle = Math.atan2(
        Math.sin(finalAngle - startAngle),
        Math.cos(finalAngle - startAngle)
      );
      // Human overshoots slightly then settles on finalAngle
      const totalSweepSteps = 14;
      let sweepStep = 0;

      const sweepInterval = setInterval(() => {
        sweepStep++;
        if (sweepStep <= 10) {
          const t = sweepStep / 10;
          // Smooth ease-out with slight human overshoot at t=0.8
          const ease = t < 0.8 ? (t / 0.8) * 1.06 : 1.06 - ((t - 0.8) / 0.2) * 0.06;
          setAimAngle(startAngle + deltaAngle * ease);
          setShotPower(Math.round(35 + (finalPower - 35) * t));
        } else if (sweepStep === 11) {
          setHumanThoughtText("Pulling back cue stick...");
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

  // Pointer aiming on the SVG pool table (supports normal and forced 90-degree rotated landscape)
  const updateAimFromClientPoint = (clientX: number, clientY: number) => {
    if (!isMyTurn || !svgRef.current) return;
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue || cue.potted) return;

    const rect = svgRef.current.getBoundingClientRect();
    let svgX = 0;
    let svgY = 0;

    if (forcedLandscape && isPortraitMobile) {
      const relX = (clientY - rect.top) / Math.max(1, rect.height);
      const relY = 1 - (clientX - rect.left) / Math.max(1, rect.width);
      svgX = relX * TABLE_W;
      svgY = relY * TABLE_H;
    } else {
      const relX = (clientX - rect.left) / Math.max(1, rect.width);
      const relY = (clientY - rect.top) / Math.max(1, rect.height);
      svgX = relX * TABLE_W;
      svgY = relY * TABLE_H;
    }

    const angle = Math.atan2(svgY - cue.y, svgX - cue.x);
    setAimAngle(angle);
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

  return (
    <div className="space-y-3">
      {/* ── Mobile Portrait "Turn Phone Sideways" Interactive Banner ── */}
      {isPortraitMobile && !forcedLandscape && !dismissedRotatePrompt && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-sky-500/20 to-indigo-500/20 border-2 border-amber-400/60 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 shadow-lg">
              <Smartphone className="w-6 h-6 -rotate-90 animate-pulse" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-300">
                📱 Turn Your Phone Sideways + Enable Motion Sensor!
              </p>
              <p className="text-[11px] text-slate-200 leading-snug">
                Rotate your phone to <strong>Landscape Mode</strong> or tap below to launch the full-screen horizontal tournament table with Gyro Tilt Aim!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              size="sm"
              onClick={handleEnterLandscapeMode}
              className="flex-1 sm:flex-initial h-9 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs gap-1.5"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Full Landscape Table
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDismissedRotatePrompt(true)}
              className="h-9 rounded-xl text-xs text-slate-300"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Main 8-Ball Pool Studio Stage (Supports Forced 90° Landscape on Portrait Mobile) ── */}
      <div
        className={
          forcedLandscape && isPortraitMobile
            ? "fixed inset-0 z-[90] bg-[#0b1324] flex items-center justify-center overflow-hidden"
            : "relative rounded-3xl bg-gradient-to-b from-[#131e36] via-[#0d1629] to-[#090f1d] border-2 border-sky-500/30 p-3 sm:p-5 shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden"
        }
      >
        <div
          style={
            forcedLandscape && isPortraitMobile
              ? {
                  width: "100vh",
                  height: "100vw",
                  transform: "rotate(90deg)",
                  transformOrigin: "center center",
                }
              : undefined
          }
          className={
            forcedLandscape && isPortraitMobile
              ? "p-3 flex flex-col justify-between bg-gradient-to-b from-[#131e36] to-[#090f1d]"
              : "space-y-3"
          }
        >
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

              {/* 7 Circular Ball Rack Slots (Left Player) */}
              <div className="hidden md:flex items-center gap-1.5">
                {creatorTargetIds.map((ballId) => {
                  const ballObj = state.balls.find((b) => b.id === ballId);
                  const isRemaining = ballObj && !ballObj.potted;
                  const meta = BALL_COLORS[ballId];
                  return (
                    <div
                      key={ballId}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-black transition-all ${
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
                    ? "⚡ YOUR SHOT — AIM & PULL POWER"
                    : `🧠 ${displayOpponentName.split(" ")[0]} (${levelInfo.humanSensePercent}% Human Sense)`}
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
                    {motionSensorActive ? `Gyro ${tiltDegrees > 0 ? `+${tiltDegrees}°` : `${tiltDegrees}°`}` : "Motion Aim"}
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

            {/* Right Player (Opponent / Human-Sense Persona) + 7 Target Ball Slots */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden md:flex items-center gap-1.5">
                {opponentTargetIds.map((ballId) => {
                  const ballObj = state.balls.find((b) => b.id === ballId);
                  const isRemaining = ballObj && !ballObj.potted;
                  const meta = BALL_COLORS[ballId];
                  return (
                    <div
                      key={ballId}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-black transition-all ${
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

          {/* ── Main Horizontal Arena Row: Left Cue Spin & Ball Collector | Center Mahogany & Blue Pool Table | Right Cue Power Meter ── */}
          <div className="flex items-stretch gap-2 sm:gap-3">
            {/* Left Side: Cue Ball Spin Globe & Metallic Ball Return Collector */}
            <div className="hidden sm:flex flex-col items-center justify-between w-14 py-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setSpinOffset((prev) => ({
                    x: prev.x === 0 ? 4 : prev.x === 4 ? -4 : 0,
                    y: prev.y === 0 ? -4 : 0,
                  }))
                }
                title="Cue Ball Spin (English)"
                className="w-11 h-11 rounded-full bg-gradient-to-br from-white via-slate-100 to-slate-300 border-2 border-slate-400 shadow-lg flex items-center justify-center relative cursor-pointer"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full bg-rose-600 shadow-sm transition-transform"
                  style={{
                    transform: `translate(${spinOffset.x}px, ${spinOffset.y}px)`,
                  }}
                />
              </button>

              <div className="w-11 flex-1 my-2 rounded-xl bg-gradient-to-b from-slate-800/90 via-slate-900 to-slate-950 border-2 border-slate-600/60 p-1 flex flex-col items-center justify-end gap-1 overflow-hidden shadow-inner">
                <div className="text-[8px] font-black uppercase tracking-tighter text-slate-400 mb-auto pt-1">
                  TRAY
                </div>
                {pottedBallsList.slice(-6).map((b) => {
                  const meta = BALL_COLORS[b.id];
                  return (
                    <div
                      key={b.id}
                      className="w-6 h-6 rounded-full border border-white/30 flex items-center justify-center text-[8px] font-black text-white shadow"
                      style={{
                        background: meta.stripe
                          ? `linear-gradient(180deg, #fff 22%, ${meta.main} 22%, ${meta.main} 78%, #fff 78%)`
                          : meta.main,
                      }}
                    >
                      {b.id}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Center 8-Ball Pool Table (With Gyro Motion Parallax Support) */}
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
                  onPointerDown={(e) => updateAimFromClientPoint(e.clientX, e.clientY)}
                  onPointerMove={(e) => {
                    if (e.buttons === 1) updateAimFromClientPoint(e.clientX, e.clientY);
                  }}
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

                  {/* Glowing Laser Aiming Guideline + Cue Stick (Shown for both Player AND Human-Sense Opponent Aim Sweep!) */}
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
                        const pullBack = 18 + (shotPower / 100) * 38;
                        const tipX = cueBall.x - Math.cos(aimAngle) * pullBack;
                        const tipY = cueBall.y - Math.sin(aimAngle) * pullBack;
                        const buttX = cueBall.x - Math.cos(aimAngle) * (pullBack + 210);
                        const buttY = cueBall.y - Math.sin(aimAngle) * (pullBack + 210);
                        const midX = cueBall.x - Math.cos(aimAngle) * (pullBack + 95);
                        const midY = cueBall.y - Math.sin(aimAngle) * (pullBack + 95);

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
                    return (
                      <g key={b.id} transform={`translate(${b.x}, ${b.y})`}>
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

            {/* Right Side: Cue Power Pull-Back Meter & Shoot Controls */}
            <div className="flex flex-col items-center justify-between w-16 sm:w-20 py-1 shrink-0 gap-2">
              <div className="text-center">
                <p className="text-[9px] font-black uppercase tracking-wider text-sky-300">POWER</p>
                <p className="text-xs font-black font-mono text-amber-400">{shotPower}%</p>
              </div>

              <div className="relative flex-1 w-10 rounded-2xl bg-slate-950 border-2 border-slate-700 p-1.5 flex flex-col justify-end overflow-hidden shadow-inner">
                <div
                  className="w-full rounded-xl bg-gradient-to-t from-emerald-500 via-amber-400 to-rose-500 transition-all"
                  style={{ height: `${shotPower}%` }}
                />
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={shotPower}
                  disabled={!isMyTurn}
                  onChange={(e) => setShotPower(Number(e.target.value))}
                  aria-label="Cue shot power"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  style={{ writingMode: "vertical-lr" as any }}
                />
              </div>

              <div className="flex items-center gap-1 w-full">
                <button
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() => setAimAngle((a) => a - 0.03)}
                  className="flex-1 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[10px] font-black text-slate-200 disabled:opacity-40"
                >
                  ↺
                </button>
                <button
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() => setAimAngle((a) => a + 0.03)}
                  className="flex-1 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[10px] font-black text-slate-200 disabled:opacity-40"
                >
                  ↻
                </button>
              </div>

              <Button
                type="button"
                disabled={!isMyTurn}
                onClick={() => executeShot(aimAngle, shotPower, state.turn)}
                className="w-full h-11 rounded-xl bg-gradient-to-b from-amber-400 via-orange-500 to-amber-600 hover:from-amber-300 hover:to-orange-500 text-slate-950 font-black text-[11px] shadow-lg px-1"
              >
                <Zap className="w-3.5 h-3.5 mr-0.5 shrink-0" />
                SHOOT
              </Button>
            </div>
          </div>

          {/* ── Bottom Quick Controls & Sensory Status Bar ── */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-300">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-bold text-sky-300">
                <Crosshair className="w-3.5 h-3.5" /> Touch felt or enable <strong>Motion Aim</strong> to steer laser
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-bold text-emerald-300">
                <Sparkles className="w-3.5 h-3.5" /> +40 Pts per potted ball • +300 Pts per frame win!
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
    </div>
  );
};

export default EightBallPoolBoard;
