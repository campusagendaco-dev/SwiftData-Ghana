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
import { useDeviceScreenFit } from "@/hooks/use-device-screen-fit";

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
const TABLE_CENTER_Y = TABLE_H / 2;
const BALL_R = 13.5;
const POCKET_R = 27;
const BAULK_LINE_X = 205;
const D_ZONE_RADIUS = 68;

// Multi-substep high-precision physics constants (modeled after championship Snooker/Pool engine)
const PHYSICS_SUBSTEPS = 8;
const FRICTION_PER_SUBSTEP = Math.pow(0.987, 1 / PHYSICS_SUBSTEPS);
const MINIMUM_MOVING_SPEED = 0.04;
const BALL_RESTITUTION = 0.96;
const CUSHION_RESTITUTION = 0.78;
const MAXIMUM_SHOT_SPEED = 26;
const MAXIMUM_PULL_DISTANCE = 160;
const MINIMUM_PULL_DISTANCE = 10;

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

/**
 * Checks whether a table coordinate `(x, y)` is free of any active ball overlap.
 */
function isPositionFree(
  balls: PoolBall[],
  x: number,
  y: number,
  ignoredBallId: number
): boolean {
  return balls.every(
    (ball) =>
      ball.potted ||
      ball.id === ignoredBallId ||
      Math.hypot(ball.x - x, ball.y - y) >= BALL_R * 2 + 0.5
  );
}

/**
 * Constrains cue ball placement inside the Baulk D-Zone on the break shot,
 * or anywhere within the table cushions on a mid-game Ball-in-Hand foul.
 */
function constrainCueBallPosition(
  position: { x: number; y: number },
  constrainToDZoneOnly: boolean
): { x: number; y: number } {
  const minX = BALL_R + 10;
  const maxX = TABLE_W - BALL_R - 10;
  const minY = BALL_R + 10;
  const maxY = TABLE_H - BALL_R - 10;

  if (constrainToDZoneOnly) {
    const offsetX = Math.min(position.x, BAULK_LINE_X) - BAULK_LINE_X;
    const offsetY = position.y - TABLE_CENTER_Y;
    const distanceFromCentre = Math.hypot(offsetX, offsetY);
    const maxRadius = D_ZONE_RADIUS - BALL_R;
    const scale = distanceFromCentre > maxRadius ? maxRadius / distanceFromCentre : 1;
    return {
      x: Number(Math.max(minX, BAULK_LINE_X + offsetX * scale).toFixed(1)),
      y: Number(Math.max(minY, Math.min(maxY, TABLE_CENTER_Y + offsetY * scale)).toFixed(1)),
    };
  }

  return {
    x: Number(Math.max(minX, Math.min(maxX, position.x)).toFixed(1)),
    y: Number(Math.max(minY, Math.min(maxY, position.y)).toFixed(1)),
  };
}

/**
 * Respots a ball at its designated spot `(spotX, spotY)` or the closest non-overlapping point
 * along the horizontal centerline, ensuring balls never clip into each other.
 */
function respotBallOnTable(
  balls: PoolBall[],
  ball: PoolBall,
  spotX: number,
  spotY: number
): void {
  ball.potted = false;
  ball.vx = 0;
  ball.vy = 0;
  const minX = BALL_R + 10;
  const maxX = TABLE_W - BALL_R - 10;

  for (let offset = 0; offset < TABLE_W; offset += 2) {
    for (const direction of [1, -1]) {
      const candidateX = spotX + offset * direction;
      const isInsidePlayArea = candidateX >= minX && candidateX <= maxX;
      if (isInsidePlayArea && isPositionFree(balls, candidateX, spotY, ball.id)) {
        ball.x = Number(candidateX.toFixed(1));
        ball.y = Number(spotY.toFixed(1));
        return;
      }
    }
  }
  ball.x = spotX;
  ball.y = spotY;
}

/**
 * Returns the legal first-contact target ball IDs for the current player:
 * - Open table: any solid or stripe (1..7, 9..15), never the 8-ball.
 * - Group assigned with balls remaining: only that group's balls.
 * - Group cleared (clearance phase): only the 8-ball ([8]).
 */
function getLegalTargetIds(
  balls: PoolBall[],
  group: "solids" | "stripes" | null
): number[] {
  if (!group) {
    return [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  }
  const groupIds =
    group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  const remainingInGroup = balls.filter(
    (b) => !b.potted && groupIds.includes(b.id)
  );
  if (remainingInGroup.length > 0) {
    return groupIds;
  }
  return [8];
}

export function createInitialPoolBalls(): PoolBall[] {
  const balls: PoolBall[] = [
    { id: 0, x: BAULK_LINE_X - 28, y: TABLE_CENTER_Y, vx: 0, vy: 0, potted: false },
  ];

  const rackLayout: number[][] = [
    [1],
    [9, 2],
    [3, 8, 10],
    [11, 4, 12, 5],
    [6, 13, 14, 7, 15],
  ];

  const apexX = 550;
  const apexY = TABLE_CENTER_Y;
  // Tighter triangular pyramid spacing (`BALL_R * Math.sqrt(3) + 0.5`) for crisp break-shot energy transfer
  const rowSpacingX = BALL_R * Math.sqrt(3) + 0.45;
  const colSpacingY = BALL_R * 2 + 0.4;

  for (let rowIndex = 0; rowIndex < rackLayout.length; rowIndex++) {
    const rowIds = rackLayout[rowIndex];
    for (let posInRow = 0; posInRow <= rowIndex; posInRow++) {
      const ballY = apexY + (posInRow - rowIndex / 2) * colSpacingY;
      balls.push({
        id: rowIds[posInRow],
        x: Number((apexX + rowIndex * rowSpacingX).toFixed(2)),
        y: Number(ballY.toFixed(2)),
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
  reservedTopPx?: number;
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
  reservedTopPx = 28,
  initialState,
  onStateChange,
  onPointsEarned,
  onMatchComplete,
}) => {
  const screenFit = useDeviceScreenFit();
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
  const [aimDragStart, setAimDragStart] = useState<{ x: number; y: number } | null>(null);
  const [aimDragCurrent, setAimDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

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
      ((initialState.shotCount || 0) > (state.shotCount || 0) ||
        ((initialState.shotCount || 0) === (state.shotCount || 0) &&
          initialState.turn &&
          initialState.turn !== state.turn))
    ) {
      setState((prev) => ({
        ...prev,
        ...initialState,
        balls: initialState.balls!,
      }));
    }
  }, [initialState, isSimulating, state.shotCount, state.turn]);

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

  // Prevent browser page scroll / rubber-band bounce when touching or dragging on the pool table or cue trays
  useEffect(() => {
    const preventScroll = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    const svgEl = svgRef.current;
    const fineEl = fineTrayRef.current;
    const powerEl = powerTrayRef.current;

    svgEl?.addEventListener("touchmove", preventScroll, { passive: false });
    fineEl?.addEventListener("touchmove", preventScroll, { passive: false });
    powerEl?.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      svgEl?.removeEventListener("touchmove", preventScroll);
      fineEl?.removeEventListener("touchmove", preventScroll);
      powerEl?.removeEventListener("touchmove", preventScroll);
    };
  }, [isPortraitViewport, forcedLandscape]);

  const isMyTurn =
    !state.winner &&
    !isSimulating &&
    !isOpponentAiming &&
    (mode === "p2p"
      ? state.turn === mySide || (state.shotCount || 0) === 0
      : state.turn === "creator");

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
   * Simulates a complete physics shot synchronously using 8 substeps per frame (`PHYSICS_SUBSTEPS = 8`),
   * exact impulse restitution (`BALL_RESTITUTION = 0.96`, `CUSHION_RESTITUTION = 0.78`),
   * `firstContactBallId` legal-target foul checking, and `respotBallOnTable` non-overlapping spotting,
   * then plays the frames back smoothly at 60 FPS via `requestAnimationFrame`!
   */
  const executeShot = useCallback(
    (angleRad: number, powerPercent: number, shooter: "creator" | "opponent") => {
      if (isSimulating || stateRef.current.winner) return;

      const current = stateRef.current;
      const simBalls: PoolBall[] = current.balls.map((b) => ({ ...b }));
      const cue = simBalls.find((b) => b.id === 0);
      if (!cue || cue.potted) return;

      const preShotGroup =
        shooter === "creator" ? current.creatorGroup : current.opponentGroup;
      const legalTargetIdsBeforeShot = getLegalTargetIds(simBalls, preShotGroup);

      playCueStrikeSound(powerPercent);

      const normalizedPower = Math.max(0.12, Math.min(1, powerPercent / 100));
      const speed = normalizedPower * MAXIMUM_SHOT_SPEED;
      const spinAngleAdjust = spinOffset.x * 0.0035;
      const spinSpeedBoost = 1 - spinOffset.y * 0.018;
      cue.vx = Math.cos(angleRad + spinAngleAdjust) * speed * spinSpeedBoost;
      cue.vy = Math.sin(angleRad + spinAngleAdjust) * speed * spinSpeedBoost;

      const shotReport: {
        firstContactBallId: number | null;
        pottedBalls: number[];
      } = {
        firstContactBallId: null,
        pottedBalls: [],
      };

      const frames: { balls: PoolBall[]; events: FrameAudioEvent[] }[] = [];
      let pendingEvents: FrameAudioEvent[] = [];

      const bounceOffCushions = (ball: PoolBall, currentSpd: number) => {
        const minimumX = BALL_R + 6;
        const maximumX = TABLE_W - BALL_R - 6;
        const minimumY = BALL_R + 6;
        const maximumY = TABLE_H - BALL_R - 6;

        if (ball.x < minimumX) {
          ball.x = minimumX;
          ball.vx = -ball.vx * CUSHION_RESTITUTION;
          if (currentSpd > 1.1) pendingEvents.push({ type: "rail", speed: currentSpd });
        } else if (ball.x > maximumX) {
          ball.x = maximumX;
          ball.vx = -ball.vx * CUSHION_RESTITUTION;
          if (currentSpd > 1.1) pendingEvents.push({ type: "rail", speed: currentSpd });
        }
        if (ball.y < minimumY) {
          ball.y = minimumY;
          ball.vy = -ball.vy * CUSHION_RESTITUTION;
          if (currentSpd > 1.1) pendingEvents.push({ type: "rail", speed: currentSpd });
        } else if (ball.y > maximumY) {
          ball.y = maximumY;
          ball.vy = -ball.vy * CUSHION_RESTITUTION;
          if (currentSpd > 1.1) pendingEvents.push({ type: "rail", speed: currentSpd });
        }
      };

      const potBallIfInPocket = (ball: PoolBall, currentSpd: number) => {
        const isInsideAnyPocket = POCKETS.some(
          (pocket) => Math.hypot(ball.x - pocket.x, ball.y - pocket.y) < POCKET_R
        );
        if (!isInsideAnyPocket) return;
        ball.potted = true;
        ball.vx = 0;
        ball.vy = 0;
        if (!shotReport.pottedBalls.includes(ball.id)) {
          shotReport.pottedBalls.push(ball.id);
        }
        pendingEvents.push({ type: "pocket", speed: currentSpd });
      };

      const resolveBallCollision = (firstBall: PoolBall, secondBall: PoolBall) => {
        const deltaX = secondBall.x - firstBall.x;
        const deltaY = secondBall.y - firstBall.y;
        const distanceBetweenCentres = Math.hypot(deltaX, deltaY);
        if (distanceBetweenCentres === 0 || distanceBetweenCentres >= BALL_R * 2) return;

        if (shotReport.firstContactBallId === null) {
          if (firstBall.id === 0) shotReport.firstContactBallId = secondBall.id;
          else if (secondBall.id === 0) shotReport.firstContactBallId = firstBall.id;
        }

        const normalX = deltaX / distanceBetweenCentres;
        const normalY = deltaY / distanceBetweenCentres;
        const overlapDistance = BALL_R * 2 - distanceBetweenCentres;
        firstBall.x -= (normalX * overlapDistance) / 2;
        firstBall.y -= (normalY * overlapDistance) / 2;
        secondBall.x += (normalX * overlapDistance) / 2;
        secondBall.y += (normalY * overlapDistance) / 2;

        const approachSpeed =
          (secondBall.vx - firstBall.vx) * normalX +
          (secondBall.vy - firstBall.vy) * normalY;
        if (approachSpeed >= 0) return;

        const impulse = (-approachSpeed * (1 + BALL_RESTITUTION)) / 2;
        firstBall.vx -= impulse * normalX;
        firstBall.vy -= impulse * normalY;
        secondBall.vx += impulse * normalX;
        secondBall.vy += impulse * normalY;

        if (impulse > 0.55) {
          pendingEvents.push({ type: "clack", speed: impulse });
        }
      };

      const advancePhysicsSubstep = () => {
        const movingBalls = simBalls.filter((b) => !b.potted);
        for (const ball of movingBalls) {
          ball.x += ball.vx / PHYSICS_SUBSTEPS;
          ball.y += ball.vy / PHYSICS_SUBSTEPS;
          ball.vx *= FRICTION_PER_SUBSTEP;
          ball.vy *= FRICTION_PER_SUBSTEP;
          const spd = Math.hypot(ball.vx, ball.vy);
          if (spd < MINIMUM_MOVING_SPEED) {
            ball.vx = 0;
            ball.vy = 0;
          }
          potBallIfInPocket(ball, spd);
          if (!ball.potted) {
            bounceOffCushions(ball, spd);
          }
        }

        const remainingBalls = simBalls.filter((b) => !b.potted);
        for (let firstIndex = 0; firstIndex < remainingBalls.length; firstIndex++) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < remainingBalls.length;
            secondIndex++
          ) {
            resolveBallCollision(remainingBalls[firstIndex], remainingBalls[secondIndex]);
          }
        }
      };

      const isAnyBallMoving = () =>
        simBalls.some((b) => !b.potted && (b.vx !== 0 || b.vy !== 0));

      for (let frameStep = 0; frameStep < 320; frameStep++) {
        for (let substep = 0; substep < PHYSICS_SUBSTEPS; substep++) {
          advancePhysicsSubstep();
        }

        frames.push({
          balls: simBalls.map((b) => ({
            ...b,
            x: Number(b.x.toFixed(1)),
            y: Number(b.y.toFixed(1)),
          })),
          events: pendingEvents,
        });
        pendingEvents = [];

        if (!isAnyBallMoving() && frameStep > 2) break;
      }

      const pottedThisShot = shotReport.pottedBalls;
      const firstContactId = shotReport.firstContactBallId;

      let creatorGroup = current.creatorGroup;
      let opponentGroup = current.opponentGroup;
      const otherPlayer: "creator" | "opponent" = shooter === "creator" ? "opponent" : "creator";
      const shooterLabel = shooter === "creator" ? creatorName : displayOpponentName;
      const otherLabel = otherPlayer === "creator" ? creatorName : displayOpponentName;

      const cueScratched = pottedThisShot.includes(0);
      let eightBallPotted = pottedThisShot.includes(8);
      let eightRespottedOnBreak = false;

      // If the 8-ball is potted on the opening break shot, respot it safely on the foot spot!
      if (eightBallPotted && current.shotCount === 0) {
        const eightBallObj = simBalls.find((b) => b.id === 8);
        if (eightBallObj) {
          respotBallOnTable(simBalls, eightBallObj, 550, TABLE_CENTER_Y);
          eightBallPotted = false;
          eightRespottedOnBreak = true;
        }
      }

      // If cue ball was potted, respot it safely inside the D-Zone without overlapping any ball!
      if (cueScratched) {
        const cueBallObj = simBalls.find((b) => b.id === 0)!;
        respotBallOnTable(simBalls, cueBallObj, BAULK_LINE_X - 28, TABLE_CENTER_Y);
      }

      const isWrongFirstContact =
        firstContactId !== null && !legalTargetIdsBeforeShot.includes(firstContactId);
      const isFoul = cueScratched || firstContactId === null || isWrongFirstContact;

      let newlyAssigned = false;
      if (!creatorGroup && !opponentGroup && !isFoul && !eightBallPotted) {
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
        const legallyTargetingEight =
          legalTargetIdsBeforeShot.includes(8) ||
          (activeShooterGroup !== null && remainingGroupBalls === 0);
        if (legallyTargetingEight && !isFoul) {
          winner = shooter;
          actionSummary = `🏆 ${shooterLabel} legally sank the 8-Ball and won the frame!`;
        } else {
          winner = otherPlayer;
          actionSummary = `⚠️ ${shooterLabel} committed an 8-Ball foul! ${otherLabel} wins the frame!`;
        }
      } else if (isFoul) {
        nextTurn = otherPlayer;
        nextBallInHand = true;
        if (cueScratched) {
          actionSummary = `⚠️ Foul by ${shooterLabel} (Cue ball scratch)! Ball-in-hand for ${otherLabel}.`;
        } else if (firstContactId === null) {
          actionSummary = `⚠️ Foul by ${shooterLabel} (Cue ball missed all balls)! Ball-in-hand for ${otherLabel}.`;
        } else {
          const hitMeta = BALL_COLORS[firstContactId] || { name: `Ball #${firstContactId}` };
          actionSummary = `⚠️ Foul by ${shooterLabel} (Hit ${hitMeta.name} first)! Ball-in-hand for ${otherLabel}.`;
        }
      } else {
        if (pottedOwnBalls.length > 0) {
          nextTurn = shooter;
          actionSummary = newlyAssigned
            ? `🔥 ${shooterLabel} potted Ball #${pottedOwnBalls[0]} and claimed ${activeShooterGroup?.toUpperCase()}! Extra shot!`
            : `🔥 ${shooterLabel} sank ${pottedOwnBalls.map((n) => `#${n}`).join(", ")}! Extra shot!`;
        } else if (eightRespottedOnBreak) {
          nextTurn = shooter;
          actionSummary = `🎱 8-Ball potted on the break and respotted! ${shooterLabel} continues!`;
        } else if (pottedThisShot.length > 0) {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} potted opponent's ball (${pottedThisShot
            .map((n) => `#${n}`)
            .join(", ")}). Next turn: ${otherLabel}!`;
        } else {
          nextTurn = otherPlayer;
          actionSummary = `${shooterLabel} missed. Next turn: ${otherLabel} to play!`;
        }
      }

      setIsSimulating(true);
      let frameIdx = 0;
      let rafId = 0;

      const playNextFrame = () => {
        if (frameIdx < frames.length) {
          const frame = frames[frameIdx];
          const events = frame.events || [];

          const hasPocket = events.some((e) => e.type === "pocket");
          if (hasPocket) {
            playPocketDropSound();
          } else {
            const loudestClack = events
              .filter((e) => e.type === "clack")
              .sort((a, b) => b.speed - a.speed)[0];
            if (loudestClack) {
              playBallClackSound(loudestClack.speed);
            } else {
              const railHit = events.find((e) => e.type === "rail");
              if (railHit) playRailBounceSound(railHit.speed);
            }
          }

          setState((prev) => ({
            ...prev,
            balls: frame.balls,
          }));
          frameIdx += 1;
          rafId = window.requestAnimationFrame(playNextFrame);
        } else {
          window.cancelAnimationFrame(rafId);
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

          if (isFoul && isHumanShot) {
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
            onPointsEarned?.(
              earnedPts,
              `Potted Ball ${pottedOwnBalls.map((b) => `#${b}`).join(", ")}`
            );
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
      };

      rafId = window.requestAnimationFrame(playNextFrame);
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
      executeShot(aimAngle, finalPct, mode === "p2p" ? mySide : "creator");
    }
  };

  const aimAngleRef = useRef(aimAngle);
  aimAngleRef.current = aimAngle;
  const executeShotRef = useRef(executeShot);
  executeShotRef.current = executeShot;

  // ── Human-Sense Medium Opponent with Visible Cue Sweeping & Gaussian Error ──
  useEffect(() => {
    if (
      (mode !== "ai" && mode !== "free_data") ||
      state.turn !== "opponent" ||
      Boolean(state.winner) ||
      isSimulating
    ) {
      return;
    }

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
    if (targets.length === 0) {
      targets = current.balls.filter((b) => !b.potted && b.id !== 0);
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
        if (cutCos < 0.15) continue;

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

    // Fallback if all pocket cuts were steep: aim directly at the nearest legal target ball
    if (bestScore === -999999 && targets.length > 0) {
      const nearestTarget = [...targets].sort(
        (a, b) =>
          Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y)
      )[0];
      idealAngle = Math.atan2(nearestTarget.y - cue.y, nearestTarget.x - cue.x);
      idealPower = 66;
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

    const startAngle = aimAngleRef.current;
    const deltaAngle = Math.atan2(
      Math.sin(finalAngle - startAngle),
      Math.cos(finalAngle - startAngle)
    );
    const totalSweepSteps = 14;
    let sweepStep = 0;

    const sweepInterval = window.setInterval(() => {
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
        window.clearInterval(sweepInterval);
        setIsOpponentAiming(false);
        setHumanThoughtText("");
        executeShotRef.current(finalAngle, finalPower, "opponent");
      }
    }, 105);

    return () => {
      window.clearInterval(sweepInterval);
      setIsOpponentAiming(false);
    };
  }, [
    mode,
    state.turn,
    state.winner,
    state.shotCount,
    isSimulating,
    levelInfo.aiErrorSigmaRad,
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

  // Pointer aiming, Slingshot pull-back, OR Ball-in-Hand placement on the SVG pool table
  const handleTablePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isMyTurn) return;
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue || cue.potted) return;

    const { svgX, svgY } = clientToSvgCoords(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);

    // 1. If Ball-in-Hand is active and user touches near the cue ball (or inside D-zone), let them drag/place it!
    if (state.ballInHand && Math.hypot(svgX - cue.x, svgY - cue.y) <= BALL_R * 2.8) {
      setIsDraggingCueBall(true);
      return;
    }

    // 2. Otherwise start Slingshot / Direct Table Aiming
    setAimDragStart({ x: svgX, y: svgY });
    setAimDragCurrent({ x: svgX, y: svgY });
    const angle = Math.atan2(svgY - cue.y, svgX - cue.x);
    setAimAngle(angle);
  };

  const handleTablePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isMyTurn) return;
    const cue = state.balls.find((b) => b.id === 0);
    if (!cue || cue.potted) return;

    const { svgX, svgY } = clientToSvgCoords(e.clientX, e.clientY);
    setHoverPosition({ x: svgX, y: svgY });

    if (isDraggingCueBall && state.ballInHand) {
      const constrained = constrainCueBallPosition(
        { x: svgX, y: svgY },
        state.shotCount === 0
      );

      if (isPositionFree(state.balls, constrained.x, constrained.y, 0)) {
        setState((prev) => ({
          ...prev,
          balls: prev.balls.map((b) =>
            b.id === 0 ? { ...b, x: constrained.x, y: constrained.y } : b
          ),
        }));
      }
      return;
    }

    if (aimDragStart) {
      setAimDragCurrent({ x: svgX, y: svgY });
      const pullVectorX = aimDragStart.x - svgX;
      const pullVectorY = aimDragStart.y - svgY;
      const pullDistance = Math.hypot(pullVectorX, pullVectorY);

      if (pullDistance >= MINIMUM_PULL_DISTANCE) {
        // Slingshot backwards drag: aim along pull vector and scale shot power!
        setAimAngle(Math.atan2(pullVectorY, pullVectorX));
        const pct = Math.round(
          Math.max(
            15,
            Math.min(100, (Math.min(pullDistance, MAXIMUM_PULL_DISTANCE) / MAXIMUM_PULL_DISTANCE) * 100)
          )
        );
        setShotPower(pct);
      } else {
        setAimAngle(Math.atan2(svgY - cue.y, svgX - cue.x));
      }
    }
  };

  const handleTablePointerUp = () => {
    if (isDraggingCueBall) {
      setIsDraggingCueBall(false);
      return;
    }
    if (aimDragStart && aimDragCurrent) {
      const pullVectorX = aimDragStart.x - aimDragCurrent.x;
      const pullVectorY = aimDragStart.y - aimDragCurrent.y;
      const pullDistance = Math.hypot(pullVectorX, pullVectorY);
      setAimDragStart(null);
      setAimDragCurrent(null);

      // If the player pulled back like a slingshot (>= 42px), release fires the shot immediately!
      if (isMyTurn && pullDistance >= 42) {
        const angle = Math.atan2(pullVectorY, pullVectorX);
        const pct = Math.round(
          Math.max(
            18,
            Math.min(100, (Math.min(pullDistance, MAXIMUM_PULL_DISTANCE) / MAXIMUM_PULL_DISTANCE) * 100)
          )
        );
        setAimAngle(angle);
        setShotPower(pct);
        executeShot(angle, pct, mode === "p2p" ? mySide : "creator");
      }
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
  const poolMetrics = screenFit.computePoolStageMetrics({
    forcedLandscape,
    reservedTopPx,
  });

  return (
    <div className="h-full w-full flex flex-col items-center justify-center overflow-hidden select-none">
      {/* ── STRICT PORTRAIT MODE LOCK OVERLAY (Requires Landscape View to Play!) ── */}
      {isPortraitViewport && !forcedLandscape ? (
        <div className="rounded-3xl bg-gradient-to-b from-[#0f172a] via-[#111c38] to-[#090d1a] border-2 border-amber-400/70 p-5 sm:p-8 text-center space-y-4 shadow-[0_25px_70px_rgba(0,0,0,0.9)] max-w-lg mx-auto my-auto">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(245,158,11,0.5)]">
            <Smartphone className="w-9 h-9 -rotate-90 animate-bounce" />
          </div>

          <div className="space-y-1.5 max-w-md mx-auto">
            <Badge className="bg-rose-500/20 text-rose-300 border border-rose-400/50 font-black text-xs px-3 py-0.5">
              🔒 PORTRAIT MODE RESTRICTED • {screenFit.deviceBrand.toUpperCase()} DETECTED
            </Badge>
            <h3 className="text-lg sm:text-2xl font-black text-white">
              Turn Your {screenFit.deviceBrand} Sideways to Play 8-Ball Pool Pro!
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Screen detected: <strong className="text-sky-300">{screenFit.availWidth}×{screenFit.availHeight}px</strong>. To lock the full{" "}
              <strong>Championship Blue Felt Table</strong>, <strong>Left Fine-Aim Tray</strong>, and{" "}
              <strong>Right Cue Stick Sleeve</strong> onto 100% of your display, switch to{" "}
              <strong className="text-amber-300">Landscape Mode</strong>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
            <Button
              type="button"
              onClick={handleEnterLandscapeMode}
              className="w-full sm:w-auto h-11 px-6 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-xs sm:text-sm gap-2 shadow-xl"
            >
              <Maximize2 className="w-4 h-4" />
              Auto-Fit Fullscreen Landscape ({screenFit.availHeight}×{screenFit.availWidth}px)
            </Button>
          </div>

          <p className="text-[10px] text-slate-400">
            💡 Physically rotate your phone horizontally or tap the button above to lock the full board to your screen.
          </p>
        </div>
      ) : (
        /* ── Main 8-Ball Pool Landscape Studio Stage (Mathematically Fitted 100% to Device Screen) ── */
        <div
          style={
            forcedLandscape && isPortraitViewport
              ? undefined
              : {
                  width: `${poolMetrics.stageWidthPx}px`,
                  height: `${poolMetrics.stageHeightPx}px`,
                }
          }
          className={
            forcedLandscape && isPortraitViewport
              ? "fixed inset-0 z-[90] bg-[#0b1324] flex items-center justify-center overflow-hidden touch-none overscroll-none select-none"
              : "relative rounded-xl sm:rounded-2xl bg-gradient-to-b from-[#131e36] via-[#0d1629] to-[#090f1d] border border-sky-500/30 px-1.5 py-1 shadow-[0_15px_50px_rgba(0,0,0,0.85)] flex flex-col justify-between overflow-hidden touch-none overscroll-none select-none mx-auto"
          }
        >
          <div
            style={
              forcedLandscape && isPortraitViewport
                ? {
                    width: `${screenFit.availHeight}px`,
                    height: `${screenFit.availWidth}px`,
                    transform: "rotate(90deg)",
                    transformOrigin: "center center",
                  }
                : undefined
            }
            className={
              forcedLandscape && isPortraitViewport
                ? "px-1.5 py-1 flex flex-col justify-between bg-gradient-to-b from-[#131e36] to-[#090f1d] overflow-hidden"
                : "w-full h-full flex flex-col justify-between overflow-hidden"
            }
          >
            {/* ── Ultra-Compact Single-Line Top Tournament HUD Bar ── */}
            <div
              style={{ height: `${poolMetrics.hudHeightPx}px` }}
              className="shrink-0 flex items-center justify-between gap-1 px-1"
            >
              {/* Left Player (Creator) + Remaining Ball Dots */}
              <div className="flex items-center gap-1 min-w-0 shrink-0">
                <div
                  className={`px-1.5 py-0.5 rounded-lg border flex items-center gap-1 transition-all ${
                    state.turn === "creator"
                      ? "bg-emerald-950/90 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.35)]"
                      : "bg-slate-900/80 border-white/15 opacity-75"
                  }`}
                >
                  <div className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 font-black text-[8px] sm:text-[9px] shrink-0">
                    {creatorName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="leading-none">
                    <p className="text-[9px] sm:text-[10px] font-black text-white truncate max-w-[64px] sm:max-w-[105px]">
                      {creatorName}
                    </p>
                    <p className="text-[7px] sm:text-[8px] font-extrabold uppercase text-emerald-300">
                      {state.creatorGroup ? state.creatorGroup.toUpperCase() : "OPEN"}
                    </p>
                  </div>
                </div>

                <div className="hidden lg:flex items-center gap-0.5">
                  {creatorTargetIds.map((ballId) => {
                    const ballObj = state.balls.find((b) => b.id === ballId);
                    const isRemaining = ballObj && !ballObj.potted;
                    const meta = BALL_COLORS[ballId];
                    return (
                      <div
                        key={ballId}
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[6px] font-black ${
                          state.creatorGroup && isRemaining
                            ? "border-white/40"
                            : "border-white/10 bg-slate-900/50 text-slate-600"
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

              {/* Center Single-Line Turn, Auto-Fit Indicator & Sensory Controls */}
              <div className="flex items-center gap-1 min-w-0 justify-center">
                <Badge
                  className={
                    isMyTurn
                      ? "bg-emerald-500 text-slate-950 font-black text-[8px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 truncate max-w-[145px] sm:max-w-[260px]"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[8px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 truncate max-w-[145px] sm:max-w-[260px]"
                  }
                >
                  {state.winner
                    ? `🏆 ${state.winner === "creator" ? creatorName : displayOpponentName} WINS!`
                    : isSimulating
                    ? "🎱 BALLS IN MOTION..."
                    : isMyTurn
                    ? state.ballInHand
                      ? "✋ BALL IN HAND — DRAG CUE"
                      : "⚡ YOUR TURN — AIM & PULL CUE"
                    : isOpponentAiming && humanThoughtText
                    ? `💭 ${humanThoughtText}`
                    : `⏳ ${displayOpponentName.split(" ")[0]}'S TURN`}
                </Badge>

                <span
                  title={`Auto-fitted for ${screenFit.deviceModelHint} (${poolMetrics.tableWidthPx}×${poolMetrics.tableHeightPx}px table)`}
                  className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-400/30 text-[8px] font-mono font-bold text-sky-300 shrink-0"
                >
                  📱 {poolMetrics.fitSummaryLabel}
                </span>

                <button
                  type="button"
                  onClick={toggleMotionSensor}
                  title="Toggle Phone Gyroscope / Motion Sensor Fine-Aim"
                  className={`h-5 sm:h-6 px-1.5 rounded-md border text-[8px] sm:text-[9px] font-black flex items-center gap-0.5 transition-all cursor-pointer shrink-0 ${
                    motionSensorActive
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                      : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  <Compass className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${motionSensorActive ? "animate-spin" : ""}`} />
                  <span className="hidden md:inline">
                    {motionSensorActive
                      ? `${tiltDegrees > 0 ? `+${tiltDegrees}°` : `${tiltDegrees}°`}`
                      : "Gyro"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleSound}
                  title={soundOn ? "Mute Audio" : "Unmute Audio"}
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                    soundOn
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-white/5 border-white/10 text-slate-500"
                  }`}
                >
                  {soundOn ? <Volume2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> : <VolumeX className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
                </button>

                <button
                  type="button"
                  onClick={handleToggleVibe}
                  title={vibeOn ? "Vibration Active" : "Vibration Off"}
                  className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                    vibeOn
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "bg-white/5 border-white/10 text-slate-500"
                  }`}
                >
                  <Vibrate className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    forcedLandscape ? setForcedLandscape(false) : handleEnterLandscapeMode()
                  }
                  title="Lock / Unlock Fullscreen Landscape Board"
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 text-sky-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  {forcedLandscape ? (
                    <Minimize2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  ) : (
                    <Maximize2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  )}
                </button>
              </div>

              {/* Right Player (Opponent) + Remaining Ball Dots */}
              <div className="flex items-center gap-1 min-w-0 shrink-0">
                <div className="hidden lg:flex items-center gap-0.5">
                  {opponentTargetIds.map((ballId) => {
                    const ballObj = state.balls.find((b) => b.id === ballId);
                    const isRemaining = ballObj && !ballObj.potted;
                    const meta = BALL_COLORS[ballId];
                    return (
                      <div
                        key={ballId}
                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[6px] font-black ${
                          state.opponentGroup && isRemaining
                            ? "border-white/40"
                            : "border-white/10 bg-slate-900/50 text-slate-600"
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
                  className={`px-1.5 py-0.5 rounded-lg border flex items-center gap-1 transition-all ${
                    state.turn === "opponent"
                      ? "bg-amber-950/90 border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.35)]"
                      : "bg-slate-900/80 border-white/15 opacity-75"
                  }`}
                >
                  <div className="leading-none text-right">
                    <p className="text-[9px] sm:text-[10px] font-black text-white truncate max-w-[64px] sm:max-w-[105px]">
                      {displayOpponentName}
                    </p>
                    <p className="text-[7px] sm:text-[8px] font-extrabold uppercase text-amber-300">
                      {state.opponentGroup
                        ? state.opponentGroup.toUpperCase()
                        : mode !== "p2p"
                        ? `${levelInfo.humanSensePercent}% AI`
                        : "OPEN"}
                    </p>
                  </div>
                  <div className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-slate-950 font-black text-[8px] sm:text-[9px] shrink-0">
                    {mode !== "p2p"
                      ? levelInfo.persona.avatarInitials
                      : displayOpponentName.slice(0, 2).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Main Horizontal Arena Row: Left Aim Tray | Center Pixel-Fitted Pool Table | Right Cue-Stick Tray ── */}
            <div className="flex-1 min-h-0 flex items-center justify-center gap-1.5 sm:gap-2.5 overflow-hidden">
              {/* LEFT SIDE DOCK: Cue Spin Globe + Interactive Fine-Aiming Stick Tray + Potted Rack */}
              <div
                style={{
                  width: `${poolMetrics.leftDockWidthPx}px`,
                  height: `${poolMetrics.dockHeightPx}px`,
                }}
                className="flex flex-col items-center justify-between py-0.5 shrink-0 gap-1 select-none"
              >
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
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-white via-slate-100 to-slate-300 border-2 border-slate-400 shadow flex items-center justify-center relative cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <span className="absolute inset-1 rounded-full border border-dashed border-slate-400/60" />
                  <span
                    className="w-2 h-2 rounded-full bg-rose-600 shadow-sm transition-transform"
                    style={{
                      transform: `translate(${spinOffset.x}px, ${spinOffset.y}px)`,
                    }}
                  />
                </button>

                {/* 2. Interactive Fine-Aiming Wheel Tray */}
                <div className="flex-1 min-h-0 w-full flex flex-col items-center">
                  <div className="flex items-center justify-between w-full px-0.5 mb-0.5">
                    <button
                      type="button"
                      disabled={!isMyTurn}
                      onClick={() => adjustStickAngleByDelta(-0.006, -4)}
                      className="px-1 py-0 rounded bg-slate-800 hover:bg-slate-700 text-[7px] font-black text-amber-300 border border-white/10 cursor-pointer disabled:opacity-40"
                    >
                      ▲
                    </button>
                    <span className="text-[6.5px] font-mono font-black text-sky-300">
                      {angleDegreesDisplay}°
                    </span>
                    <button
                      type="button"
                      disabled={!isMyTurn}
                      onClick={() => adjustStickAngleByDelta(0.006, 4)}
                      className="px-1 py-0 rounded bg-slate-800 hover:bg-slate-700 text-[7px] font-black text-amber-300 border border-white/10 cursor-pointer disabled:opacity-40"
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
                    className={`relative flex-1 min-h-0 w-full rounded-xl bg-gradient-to-r from-slate-300 via-white to-slate-300 border-2 ${
                      isMyTurn
                        ? "border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)] cursor-ns-resize"
                        : "border-slate-600 opacity-60 cursor-default"
                    } overflow-hidden flex flex-col justify-between py-1 touch-none`}
                  >
                    <div className="absolute inset-y-0 left-1 w-0.5 bg-slate-400/70 pointer-events-none" />
                    <div className="absolute inset-y-0 right-1 w-0.5 bg-slate-400/70 pointer-events-none" />

                    <div
                      className="w-full h-full flex flex-col justify-around items-center pointer-events-none"
                      style={{
                        transform: `translateY(${fineWheelOffset * 0.45}px)`,
                      }}
                    >
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-[2px] rounded-full ${
                            i % 3 === 0 ? "w-5 bg-slate-800" : "w-3.5 bg-slate-500/80"
                          }`}
                        />
                      ))}
                    </div>

                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-rose-600 shadow pointer-events-none" />
                    <div className="absolute bottom-0.5 inset-x-0 text-center pointer-events-none">
                      <span className="px-1 py-0.2 rounded bg-slate-950/85 text-[6px] font-black text-amber-300 uppercase">
                        AIM
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Compact Potted Ball Return Window */}
                <div className="w-full h-8 sm:h-10 rounded-lg bg-slate-950/90 border border-slate-600/70 p-0.5 flex flex-wrap items-center justify-center gap-0.5 overflow-hidden shadow-inner shrink-0">
                  {pottedBallsList.length === 0 ? (
                    <span className="text-[5.5px] font-bold text-slate-500 text-center leading-tight">
                      POTTED
                    </span>
                  ) : (
                    pottedBallsList.slice(-6).map((b) => {
                      const meta = BALL_COLORS[b.id];
                      return (
                        <div
                          key={b.id}
                          className="w-3 h-3 rounded-full border border-white/30 flex items-center justify-center text-[5px] font-black text-white"
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

              {/* CENTER 8-BALL POOL TABLE (Explicitly Sized in Pixels by Device Detector!) */}
              <div className="shrink-0 flex items-center justify-center overflow-hidden">
                <div
                  style={{
                    width: `${poolMetrics.tableWidthPx}px`,
                    height: `${poolMetrics.tableHeightPx}px`,
                    padding: `${poolMetrics.railPaddingPx}px`,
                    ...(motionSensorActive
                      ? {
                          transform: `perspective(900px) rotateY(${parallaxOffset.x * 0.35}deg) rotateX(${-parallaxOffset.y * 0.35}deg)`,
                          transition: "transform 120ms ease-out",
                        }
                      : {}),
                  }}
                  className="relative rounded-[16px] sm:rounded-[22px] bg-gradient-to-b from-[#9c421a] via-[#6e2a0c] to-[#4a1a06] border-2 sm:border-4 border-[#381204] shadow-[0_14px_40px_rgba(0,0,0,0.9),inset_0_2px_6px_rgba(255,255,255,0.25)] flex items-center justify-center select-none"
                >
                  {/* Floating Turn Spotlight Overlay (Zero Layout Shift!) */}
                  {turnBanner && (
                    <div
                      className={`absolute top-2.5 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full border shadow-xl flex items-center gap-2 pointer-events-none animate-in fade-in zoom-in-95 duration-150 ${
                        turnBanner.isMe
                          ? "bg-emerald-950/95 border-emerald-400 text-white"
                          : "bg-amber-950/95 border-amber-400 text-white"
                      }`}
                    >
                      <BellRing className="w-3 h-3 text-amber-300 shrink-0" />
                      <span className="text-[10px] font-black tracking-wide whitespace-nowrap">
                        {turnBanner.isMe
                          ? `🟢 YOUR TURN, ${turnBanner.playerName.toUpperCase()}!`
                          : `🔔 ${turnBanner.playerName.toUpperCase()}'S TURN`}
                      </span>
                    </div>
                  )}

                  {/* Floating Live Points Earned Banner */}
                  {floatingRewardText && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-400 text-slate-950 font-black text-[10px] shadow-[0_10px_30px_rgba(245,158,11,0.6)] animate-bounce pointer-events-none whitespace-nowrap">
                      {floatingRewardText}
                    </div>
                  )}

                  {/* Winner Next Frame Overlay Button */}
                  {state.winner && mode !== "p2p" && (
                    <div className="absolute inset-0 z-30 bg-black/55 backdrop-blur-[2px] rounded-[16px] flex flex-col items-center justify-center gap-2 p-4">
                      <p className="text-sm sm:text-base font-black text-white">
                        🏆 {state.winner === "creator" ? creatorName : displayOpponentName} Wins the Frame!
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          const fresh: EightBallPoolState = {
                            ...INITIAL_POOL_STATE,
                            balls: createInitialPoolBalls(),
                          };
                          setState(fresh);
                          onStateChange?.(fresh);
                        }}
                        className="h-9 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black gap-1.5 shadow-xl"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Play Next Frame (+Points)
                      </Button>
                    </div>
                  )}

                  {/* Silver / Chrome Corner & Center Pocket Castings */}
                  <div className="absolute top-0 left-0 w-6 h-6 sm:w-8 sm:h-8 rounded-tl-[16px] sm:rounded-tl-[20px] rounded-br-xl bg-gradient-to-br from-slate-200 via-slate-400 to-slate-700 border-b border-r border-slate-900 pointer-events-none" />
                  <div className="absolute top-0 right-0 w-6 h-6 sm:w-8 sm:h-8 rounded-tr-[16px] sm:rounded-tr-[20px] rounded-bl-xl bg-gradient-to-bl from-slate-200 via-slate-400 to-slate-700 border-b border-l border-slate-900 pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 sm:w-8 sm:h-8 rounded-bl-[16px] sm:rounded-bl-[20px] rounded-tr-xl bg-gradient-to-tr from-slate-200 via-slate-400 to-slate-700 border-t border-r border-slate-900 pointer-events-none" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 sm:w-8 sm:h-8 rounded-br-[16px] sm:rounded-br-[20px] rounded-tl-xl bg-gradient-to-tl from-slate-200 via-slate-400 to-slate-700 border-t border-l border-slate-900 pointer-events-none" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-9 h-2.5 sm:w-11 sm:h-3.5 rounded-b-lg bg-gradient-to-b from-slate-200 via-slate-400 to-slate-700 pointer-events-none" />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-9 h-2.5 sm:w-11 sm:h-3.5 rounded-t-lg bg-gradient-to-t from-slate-200 via-slate-400 to-slate-700 pointer-events-none" />

                  {/* Interactive SVG Tournament Blue Felt Surface */}
                  <div className="relative w-full h-full rounded-lg sm:rounded-xl overflow-hidden border-[3px] sm:border-[5px] border-[#114b7a] shadow-[inset_0_0_30px_rgba(0,0,0,0.65)]">
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${TABLE_W} ${TABLE_H}`}
                      onPointerDown={handleTablePointerDown}
                      onPointerMove={handleTablePointerMove}
                      onPointerUp={handleTablePointerUp}
                      onPointerCancel={handleTablePointerUp}
                      className="w-full h-full block touch-none cursor-crosshair"
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

                      {/* Baulk Line, D-Zone Semicircle & Foot Spot */}
                      <line
                        x1={BAULK_LINE_X}
                        y1={0}
                        x2={BAULK_LINE_X}
                        y2={TABLE_H}
                        stroke="rgba(255,255,255,0.28)"
                        strokeWidth={1.5}
                      />
                      <path
                        d={`M ${BAULK_LINE_X} ${TABLE_CENTER_Y - D_ZONE_RADIUS} A ${D_ZONE_RADIUS} ${D_ZONE_RADIUS} 0 0 0 ${BAULK_LINE_X} ${TABLE_CENTER_Y + D_ZONE_RADIUS}`}
                        fill="none"
                        stroke="rgba(255,255,255,0.28)"
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
                      {/* Ghost Cue Ball Preview when dragging Ball-in-Hand + Slingshot Power Bar */}
                      {isDraggingCueBall && state.ballInHand && hoverPosition && (() => {
                        const ghostPos = constrainCueBallPosition(
                          hoverPosition,
                          state.shotCount === 0
                        );
                        return (
                          <circle
                            cx={ghostPos.x}
                            cy={ghostPos.y}
                            r={BALL_R}
                            fill="#ffffff"
                            opacity={0.55}
                            stroke="#38bdf8"
                            strokeWidth={2}
                            strokeDasharray="3 2"
                          />
                        );
                      })()}
                      {aimDragStart && aimDragCurrent && isMyTurn && (
                        <rect
                          x={24}
                          y={TABLE_H - 14}
                          width={(shotPower / 100) * 180}
                          height={6}
                          rx={3}
                          fill={`hsl(${120 - (shotPower / 100) * 120}, 85%, 52%)`}
                        />
                      )}
                    </svg>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE DOCK: Tapered Cue-Stick Pull-Back Sleeve Tray & Shoot Trigger */}
              <div
                style={{
                  width: `${poolMetrics.rightDockWidthPx}px`,
                  height: `${poolMetrics.dockHeightPx}px`,
                }}
                className="flex flex-col items-center justify-between py-0.5 shrink-0 gap-1 select-none"
              >
                <div className="text-center leading-none">
                  <p className="text-[6.5px] font-black uppercase tracking-wider text-sky-300">
                    POWER
                  </p>
                  <p className="text-[9px] sm:text-[10px] font-black font-mono text-amber-400">{shotPower}%</p>
                </div>

                {/* Interactive Pull-Back Cue Stick Sleeve (Drag Down & Release to Strike!) */}
                <div
                  ref={powerTrayRef}
                  onPointerDown={handlePowerTrayPointerDown}
                  onPointerMove={handlePowerTrayPointerMove}
                  onPointerUp={handlePowerTrayPointerUp}
                  onPointerCancel={handlePowerTrayPointerUp}
                  title="Drag down to pull back Pool Stick & release to shoot!"
                  className={`relative flex-1 min-h-0 w-full rounded-2xl bg-gradient-to-b from-slate-900 via-slate-950 to-black border-2 ${
                    isMyTurn
                      ? "border-sky-400/80 shadow-[0_0_12px_rgba(56,189,248,0.28)] cursor-ns-resize"
                      : "border-slate-700 opacity-60 cursor-default"
                  } p-1 flex flex-col justify-between overflow-hidden touch-none`}
                >
                  <div className="w-full h-2 rounded-sm bg-gradient-to-r from-slate-300 via-white to-slate-400 border border-slate-800 shadow z-10 pointer-events-none" />

                  <div
                    className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-emerald-500/35 via-amber-400/45 to-rose-500/55 transition-all pointer-events-none"
                    style={{ height: `${shotPower}%` }}
                  />

                  <div
                    className="relative z-10 mx-auto w-2.5 h-full flex flex-col items-center pointer-events-none transition-transform duration-75"
                    style={{
                      transform: `translateY(${Math.round((shotPower / 100) * 32)}px)`,
                    }}
                  >
                    <div className="w-2 h-1.5 rounded-t-sm bg-sky-400 border-b border-white" />
                    <div className="w-2 h-10 bg-gradient-to-r from-amber-100 via-white to-amber-200" />
                    <div className="w-2.5 flex-1 rounded-b-md bg-gradient-to-b from-amber-600 via-stone-900 to-black border border-amber-500/40" />
                  </div>

                  <div className="relative z-20 text-center pointer-events-none">
                    <span className="px-1 py-0.2 rounded bg-black/80 text-[5.5px] font-black text-amber-300 uppercase">
                      {isPullingPowerTray ? "FIRE!" : "PULL"}
                    </span>
                  </div>
                </div>

                {/* Instant Shoot Button */}
                <Button
                  type="button"
                  disabled={!isMyTurn}
                  onClick={() => executeShot(aimAngle, shotPower, mode === "p2p" ? mySide : "creator")}
                  className="w-full h-6 sm:h-7 rounded-lg bg-gradient-to-b from-amber-400 via-orange-500 to-amber-600 hover:from-amber-300 hover:to-orange-500 text-slate-950 font-black text-[8px] sm:text-[9px] shadow px-0.5 shrink-0"
                >
                  <Zap className="w-2.5 h-2.5 mr-0.5 shrink-0" />
                  SHOOT
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EightBallPoolBoard;
