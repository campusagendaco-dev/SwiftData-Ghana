import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Users,
  Wallet,
  Trophy,
  Sparkles,
  Gift,
  Smartphone,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Zap,
  FastForward,
  BookOpen,
  X,
  Film,
  Download,
  RotateCcw,
} from "lucide-react";

export type ArenaGameType = "oware" | "ludo" | "dame" | "pool" | "slash" | "candy" | "buggy";

/** Official playlist order starting from Ghana Oware */
export const GAMEPLAY_VIDEO_ORDER: ArenaGameType[] = [
  "oware",
  "ludo",
  "dame",
  "pool",
  "slash",
  "candy",
  "buggy",
];

interface ChallengeHowItWorksProps {
  onQuickStart?: (game: ArenaGameType, mode: "p2p" | "ai" | "free_data") => void;
}

interface GameStepGuide {
  title: string;
  shortName: string;
  tagline: string;
  emoji: string;
  badge: string;
  accentGradient: string;
  steps: {
    stepNum: string;
    heading: string;
    detail: string;
    tip: string;
  }[];
}

export const GAME_STEP_GUIDES: Record<ArenaGameType, GameStepGuide> = {
  oware: {
    title: "Ghana Oware (Nam-Nam & Abapa)",
    shortName: "Ghana Oware",
    tagline: "Authentic 12-bowl Akan hinged ebony & terracotta board with continuous relay sowing!",
    emoji: "🪨",
    badge: "🇬🇭 #1 Ghana Game",
    accentGradient: "from-amber-500 to-orange-500",
    steps: [
      {
        stepNum: "01",
        heading: "Tap Any of Your 6 Bottom Terracotta Bowls",
        detail:
          "Scoop all nickernut seeds from your chosen bowl and drop them one-by-one counter-clockwise around the board.",
        tip: "You can switch between Nam-Nam Relay and Abapa Tournament rules before move 1.",
      },
      {
        stepNum: "02",
        heading: "Continuous Nam-Nam Relay Sowing",
        detail:
          "In Nam-Nam mode, if your last seed lands in a non-empty bowl, you automatically scoop those seeds and keep sowing!",
        tip: "Your turn only ends when your last seed drops into an empty bowl.",
      },
      {
        stepNum: "03",
        heading: "The 4-Seed Harvest Rule (+4 🔥)",
        detail:
          "Whenever any bowl reaches 4 seeds during sowing, the row owner harvests them. If your very last seed makes 4, YOU capture them!",
        tip: "Watch the 18s Turn Shot Clock and harvest combos to build your lead.",
      },
      {
        stepNum: "04",
        heading: "Capture 25+ Seeds Into Your Kulo to Win",
        detail:
          "Outscore your opponent (or Nana Kwame Asante • 93% Human Sense) by capturing 25 or more seeds into your Kulo storehouse!",
        tip: "Count your opponent's seeds before sowing so you don't feed them a 4-seed bowl.",
      },
    ],
  },
  ludo: {
    title: "Ghana Ludo (Pro 52-Cell • 2–4 Players)",
    shortName: "Ghana Ludo",
    tagline: "Official 52-cell track, 4 tokens in Base, 8 Safe Squares, Blockades & invite up to 3 friends!",
    emoji: "🎲",
    badge: "🎲 2–4 Players",
    accentGradient: "from-rose-500 to-amber-500",
    steps: [
      {
        stepNum: "01",
        heading: "Roll 6 on the 3D Blue Dice to Launch from Base",
        detail:
          "All 4 tokens begin inside your Base. Roll a 6 to move a token onto your colored starting cell and earn an extra turn!",
        tip: "You can switch between 2P, 3P, or 4P and invite friends to Green, Yellow, or Blue!",
      },
      {
        stepNum: "02",
        heading: "52-Cell Circuit, Captures & 8 Protected Safe Squares",
        detail:
          "Move clockwise around all 52 main-track cells. Land on an opponent token on a non-safe square to kick it back to Base and earn a Bonus Roll!",
        tip: "The 4 Starting squares and 4 Star (★) squares are safe from capture.",
      },
      {
        stepNum: "03",
        heading: "Form Blockades (🛡️ 2+ Tokens) & Choose Every Move",
        detail:
          "Stack 2 or more of your tokens on the same square to form a Blockade that opponents cannot pass or land on.",
        tip: "Use a Blockade on a choke point to trap opponent runners behind you.",
      },
      {
        stepNum: "04",
        heading: "Bring All 4 Tokens Home by Exact Roll",
        detail:
          "After completing a full 51-step circuit, enter your private 6-cell Home Path and bring all 4 tokens into the Center Home Triangle by exact dice roll to win!",
        tip: "Overshooting the final home triangle is not allowed — wait for the exact dice number.",
      },
    ],
  },
  dame: {
    title: "Ghanaian Dame (8×8 Draughts)",
    shortName: "Ghana Dame",
    tagline: "Classic Ghanaian checkers with mandatory diagonal jump captures and Crowned Kings!",
    emoji: "♟️",
    badge: "♟️ Pure Strategy",
    accentGradient: "from-emerald-500 to-teal-500",
    steps: [
      {
        stepNum: "01",
        heading: "Tap a Piece to Highlight Diagonal Moves",
        detail:
          "All pieces move diagonally on the dark wood squares. Tap your gold/red piece to see valid green target squares.",
        tip: "Pieces that have a legal move glow with an emerald ring.",
      },
      {
        stepNum: "02",
        heading: "Mandatory Jump Captures ('Chop!')",
        detail:
          "Whenever an opponent piece can be jumped diagonally (forward or backward), the jump capture is mandatory!",
        tip: "Chain multiple double/triple jumps together to clear your opponent's defense.",
      },
      {
        stepNum: "03",
        heading: "Reach the Back Row to Crown a King (👑)",
        detail:
          "When your piece reaches the far opposite row, it is crowned a King and can move & capture in all 4 diagonal directions.",
        tip: "Protect your back row so your opponent cannot easily make a King.",
      },
      {
        stepNum: "04",
        heading: "Capture All Opponent Pieces to Win",
        detail:
          "Capture all opponent pieces or block them from making any legal move before the shot clock expires to claim victory!",
        tip: "Control the center squares to restrict Kofi Mensah's movement.",
      },
    ],
  },
  pool: {
    title: "8-Ball Pool (Landscape Pro)",
    shortName: "8-Ball Pool",
    tagline: "Turn your phone sideways, aim with the cue laser & Gyro sensor, and sink the 8-Ball!",
    emoji: "🎱",
    badge: "🎱 Landscape Pro",
    accentGradient: "from-sky-500 to-blue-600",
    steps: [
      {
        stepNum: "01",
        heading: "Rotate Phone Sideways & Aim Cue Laser",
        detail:
          "Drag on the Championship Blue table (or use the Fine-Tune wheel / Gyro Tilt Sensor) to align the dual-circle ghost ball sight.",
        tip: "Tap the Gyro Tilt button if you want phone-tilt micro-aiming!",
      },
      {
        stepNum: "02",
        heading: "Set Cue Spin & Pull Back Power Slider",
        detail:
          "Adjust English spin on the cue ball pad, then drag down the Right Power Meter (15%–100%) and release to strike.",
        tip: "Use softer power (35%–55%) on thin cut shots so the cue ball doesn't scratch.",
      },
      {
        stepNum: "03",
        heading: "Claim Solids (1–7) or Stripes (9–15)",
        detail:
          "The first ball legally potted after the break locks in your group. Pot a ball of your group to keep your turn!",
        tip: "If the cue ball drops in a pocket, your opponent gets Ball-in-Hand.",
      },
      {
        stepNum: "04",
        heading: "Sink the Black 8-Ball Last to Win",
        detail:
          "Once all 7 of your group balls are cleared, legally sink the Black 8-Ball to win the frame!",
        tip: "Never pot the 8-Ball early — that is an instant loss of frame.",
      },
    ],
  },
  slash: {
    title: "Market Slash (60s Blitz • Fruit Slash)",
    shortName: "Market Slash",
    tagline: "Swipe fast across the dark wood dojo to slice Watermelons, Oranges & Kiwis before the 60s clock runs out!",
    emoji: "🍉",
    badge: "🔪 60s Blitz",
    accentGradient: "from-amber-500 to-orange-600",
    steps: [
      {
        stepNum: "01",
        heading: "Swipe Across Flying Market Fruits",
        detail:
          "Drag your finger or mouse quickly across Watermelons, Oranges, Apples, Kiwis, and Lemons tossed up from the market stall.",
        tip: "Short, quick swipes give you the cleanest glowing blade arc!",
      },
      {
        stepNum: "02",
        heading: "Slice Multi-Fruit Combos (2× / 3× / 4×)",
        detail:
          "Cut 2, 3, or 4 fruits in a single swipe to trigger a COMBO bonus and paint juicy splatters across the wooden board.",
        tip: "Wait until fruits peak together at the top of their arc for easy 3× combos.",
      },
      {
        stepNum: "03",
        heading: "Beat the 60-Second Blitz Clock (⏱️ 1:00)",
        detail:
          "Reach the target stall score before the 60-second Blitz timer hits 0:00 to outscore Madam Akua Reflex!",
        tip: "Clear all 5 market stages to maximize your match score.",
      },
      {
        stepNum: "04",
        heading: "Dodge Sparking Bombs & Avoid 3 Drops (✕✕✕)",
        detail:
          "Never slice a sparking black Bomb (instant Game Over!) and don't let 3 unsliced fruits drop off the bottom.",
        tip: "Watch closely when bombs fly up next to large watermelons!",
      },
    ],
  },
  candy: {
    title: "Candy Crash (Alewa & Kube • 75s Rush)",
    shortName: "Candy Crash",
    tagline: "Swap Ghanaian Alewa, Kube & Golden Cocoa Pods — forge Kente Boosters & Calabash Bombs!",
    emoji: "🍬",
    badge: "🍬 75s Sweet Rush",
    accentGradient: "from-amber-500 to-rose-500",
    steps: [
      {
        stepNum: "01",
        heading: "Swipe or Tap Adjacent Ghanaian Sweets",
        detail:
          "Drag any sweet (Alewa Toffee, Kube Coconut, Golden Cocoa Pod, Nkate Cake, Sobolo Crystal, or Bofrot Puff) to match 3 or more.",
        tip: "Match near the bottom of the 8×8 wooden tray to trigger free falling cascades!",
      },
      {
        stepNum: "02",
        heading: "Match 4 for a Kente-Striped Booster (🇬🇭)",
        detail:
          "Matching 4 sweets wraps a glowing Red-Gold-Green Kente-Striped Sweet. Matching it blasts an entire row or column!",
        tip: "Swap two Kente-Striped sweets together to fire an instant Row + Column Cross Blast!",
      },
      {
        stepNum: "03",
        heading: "Match 5 for a Takoradi Calabash Cocoa Bomb (🍫)",
        detail:
          "Matching 5 sweets forges a Golden Star Calabash Cocoa Bomb. Swap it with any sweet to detonate every sweet of that type!",
        tip: "Save your Calabash Cocoa Bomb for the most common sweet on the tray.",
      },
      {
        stepNum: "04",
        heading: "Beat the 75-Second Rush Timer & Clear 10 Markets",
        detail:
          "Hit the market target score before the 75-second clock or your moves run out to earn up to 3 Stars (★★★)!",
        tip: "Stuck? Tap the Hint button at the bottom to pulse a valid sweet swap.",
      },
    ],
  },
  buggy: {
    title: "Labadi Beach & Aburi Buggy GP (Landscape)",
    shortName: "Labadi Buggy GP",
    tagline:
      "Strict Landscape 3D Rally! Steer with the Wheel (🛞), Motion Tilt (📱) or Arrows (◀ ▶) across 3 laps in 95s!",
    emoji: "🏎️",
    badge: "🏎️ 3D Landscape GP",
    accentGradient: "from-red-500 via-amber-500 to-emerald-500",
    steps: [
      {
        stepNum: "01",
        heading: "Strict Landscape View & 3-Way Steering Switcher",
        detail:
          "Automatically locks to full-screen Landscape! Switch anytime between the draggable Steering Wheel (🛞), Motion Tilt Sensor (📱), or Touch Arrows (◀ ▶).",
        tip: "Drag the left Steering Wheel smoothly up to ±65° for precise hairpin cornering!",
      },
      {
        stepNum: "02",
        heading: "Hit Kente Boost Pads & Fire Shito Nitro (N₂)",
        detail:
          "Drive over glowing Red-Gold-Green Kente Boost Pads and tap the right-side N₂ Shito Nitro button to surge past Kwame Turbo!",
        tip: "Auto-Gas is ON by default so you can focus 100% on steering and Nitro timing.",
      },
      {
        stepNum: "03",
        heading: "Dodge Palms, Volcanic Rocks & Beat the 95s Cutoff",
        detail:
          "Avoid roadside obstacles so your Armor HP stays high, and complete all 3 laps before the 95-second race clock expires!",
        tip: "Stay on the asphalt road — deep sand off-road reduces your top speed.",
      },
      {
        stepNum: "04",
        heading: "Collect Gold Cedi Coins (GH₵) & Upgrade at Suame Garage",
        detail:
          "Scoop spinning Gold Ghana Cedi Coins on the track to upgrade your V8 Engine, Shito Nitro, and Kantanka Armor at Suame Magazine!",
        tip: "Finish 1st across 3 laps to claim victory and +35 verified Arena Points!",
      },
    ],
  },
};

/* ============================================================================
 * CINEMA-GRADE HTML5 CANVAS GAMEPLAY VIDEO PLAYER (STARTING FROM OWARE)
 * Renders smooth 60fps animated gameplay videos for all 7 games + WebM export
 * ========================================================================== */

const VIDEO_DURATION_SECONDS = 16; // 4 chapters × 4 seconds per chapter

export function GameplayVideoPlayer({
  gameType,
  onSelectGame,
  onPlayGameNow,
  autoAdvanceGames = true,
  compact = false,
}: {
  gameType: ArenaGameType;
  onSelectGame?: (nextGame: ArenaGameType) => void;
  onPlayGameNow?: (game: ArenaGameType) => void;
  autoAdvanceGames?: boolean;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [autoNextPlaylist, setAutoNextPlaylist] = useState(autoAdvanceGames);
  const [isRecordingWebm, setIsRecordingWebm] = useState(false);

  const elapsedRef = useRef(0);
  const isPlayingRef = useRef(true);
  const gameTypeRef = useRef<ArenaGameType>(gameType);
  const autoNextRef = useRef(autoNextPlaylist);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    autoNextRef.current = autoNextPlaylist;
  }, [autoNextPlaylist]);

  // Reset timeline to 0:00 whenever gameType changes
  useEffect(() => {
    gameTypeRef.current = gameType;
    elapsedRef.current = 0;
    setElapsedSec(0);
    setIsPlaying(true);
  }, [gameType]);

  const guide = GAME_STEP_GUIDES[gameType] || GAME_STEP_GUIDES.oware;
  const activeChapterIdx = Math.min(3, Math.floor((elapsedSec / VIDEO_DURATION_SECONDS) * 4));
  const activeStepInfo = guide.steps[activeChapterIdx] || guide.steps[0];

  const handleAdvanceToNextGame = useCallback(() => {
    const idx = GAMEPLAY_VIDEO_ORDER.indexOf(gameTypeRef.current);
    const nextGame = GAMEPLAY_VIDEO_ORDER[(idx + 1) % GAMEPLAY_VIDEO_ORDER.length];
    if (onSelectGame) {
      onSelectGame(nextGame);
    } else {
      elapsedRef.current = 0;
      setElapsedSec(0);
    }
  }, [onSelectGame]);

  const handlePrevGame = () => {
    const idx = GAMEPLAY_VIDEO_ORDER.indexOf(gameType);
    const prevGame =
      GAMEPLAY_VIDEO_ORDER[(idx - 1 + GAMEPLAY_VIDEO_ORDER.length) % GAMEPLAY_VIDEO_ORDER.length];
    onSelectGame?.(prevGame);
  };

  const handleNextGame = () => {
    const idx = GAMEPLAY_VIDEO_ORDER.indexOf(gameType);
    const nextGame = GAMEPLAY_VIDEO_ORDER[(idx + 1) % GAMEPLAY_VIDEO_ORDER.length];
    onSelectGame?.(nextGame);
  };

  // Record & Download real .webm video from the live HTML5 Canvas stream
  const handleDownloadGameplayVideo = () => {
    const canvas = canvasRef.current;
    if (!canvas || isRecordingWebm) return;
    if (typeof (canvas as any).captureStream !== "function" || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      setIsRecordingWebm(true);
      elapsedRef.current = 0;
      setElapsedSec(0);
      setIsPlaying(true);

      const stream = (canvas as any).captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `swiftdata-${gameType}-gameplay.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsRecordingWebm(false);
      };

      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 8000);
    } catch {
      setIsRecordingWebm(false);
    }
  };

  // Main 60fps Canvas Animation Loop for all 7 Games
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let lastTs = performance.now();

    const drawRoundedRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
      fill?: string | CanvasGradient,
      stroke?: string,
      lineWidth = 2
    ) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    };

    const drawPointerHand = (x: number, y: number, clicking: boolean) => {
      ctx.save();
      ctx.translate(x, y);
      if (clicking) {
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.font = clicking ? "28px sans-serif" : "32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("👆", 0, 8);
      ctx.restore();
    };

    /* ── 1. GHANA OWARE GAMEPLAY RENDERER ── */
    const renderOwareGameplay = (t: number, W: number, H: number) => {
      // Rich mahogany backdrop
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#1c0f07");
      bg.addColorStop(0.5, "#120904");
      bg.addColorStop(1, "#090502");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Carved wooden board
      const bx = 70;
      const by = 82;
      const bw = W - 140;
      const bh = 230;
      const woodGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
      woodGrad.addColorStop(0, "#9a5b2c");
      woodGrad.addColorStop(0.5, "#743f18");
      woodGrad.addColorStop(1, "#46230b");
      drawRoundedRect(bx, by, bw, bh, 28, woodGrad, "#fbbf24", 3);

      // Left & Right Kulo Stores
      drawRoundedRect(bx + 18, by + 26, 62, bh - 52, 30, "#261205", "rgba(251,191,36,0.35)", 2);
      drawRoundedRect(
        bx + bw - 80,
        by + 26,
        62,
        bh - 52,
        30,
        "#261205",
        "rgba(52,211,153,0.45)",
        2
      );

      // Phase calculation (0..16s)
      const activePit = Math.floor(t * 2.2) % 12;
      const myHarvest = 14 + Math.min(12, Math.floor(t * 0.85));
      const oppHarvest = 11;

      // 12 Pits (Top row 0..5 Opponent, Bottom row 0..5 You)
      const pitStartX = bx + 104;
      const pitStepX = (bw - 208) / 5;
      const pitCoords: { x: number; y: number }[] = [];

      // Bottom row (0..5 left-to-right)
      for (let i = 0; i < 6; i++) {
        pitCoords.push({ x: pitStartX + i * pitStepX, y: by + 162 });
      }
      // Top row (6..11 right-to-left counter-clockwise)
      for (let i = 5; i >= 0; i--) {
        pitCoords.push({ x: pitStartX + i * pitStepX, y: by + 68 });
      }

      pitCoords.forEach((pt, idx) => {
        const isCurrentSow = idx === activePit;
        const isHarvestPit = idx === 8 && Math.floor(t) % 4 >= 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 34, 0, Math.PI * 2);
        ctx.fillStyle = "#241105";
        ctx.fill();
        ctx.lineWidth = isCurrentSow || isHarvestPit ? 3.5 : 1.5;
        ctx.strokeStyle = isHarvestPit
          ? "#34d399"
          : isCurrentSow
          ? "#fbbf24"
          : "rgba(255,255,255,0.18)";
        ctx.stroke();

        // Draw nickernut seeds inside each pit
        const seedCount = isHarvestPit ? 4 : ((idx + Math.floor(t)) % 4) + 2;
        for (let s = 0; s < seedCount; s++) {
          const ang = (s / seedCount) * Math.PI * 2 + idx;
          const r = seedCount === 1 ? 0 : 12;
          const sx = pt.x + Math.cos(ang) * r;
          const sy = pt.y + Math.sin(ang) * r;
          const sg = ctx.createRadialGradient(sx - 2, sy - 2, 1, sx, sy, 8);
          sg.addColorStop(0, "#f8fafc");
          sg.addColorStop(0.55, "#94a3b8");
          sg.addColorStop(1, "#334155");
          ctx.beginPath();
          ctx.arc(sx, sy, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = sg;
          ctx.fill();
        }

        // Seed count pill
        ctx.fillStyle = isHarvestPit ? "#34d399" : "#fde68a";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(seedCount), pt.x, pt.y + 46);
      });

      // Flying seed arc between activePit and next pit
      const fromPt = pitCoords[activePit];
      const toPt = pitCoords[(activePit + 1) % 12];
      const frac = (t * 2.2) % 1;
      const fx = fromPt.x + (toPt.x - fromPt.x) * frac;
      const fy = fromPt.y + (toPt.y - fromPt.y) * frac - Math.sin(frac * Math.PI) * 38;

      ctx.beginPath();
      ctx.arc(fx, fy, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Score readouts in stores
      ctx.fillStyle = "#fca5a5";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NANA", bx + 49, by + 55);
      ctx.font = "bold 20px monospace";
      ctx.fillText(`${oppHarvest}`, bx + 49, by + 120);

      ctx.fillStyle = "#6ee7b7";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("YOU", bx + bw - 49, by + 55);
      ctx.font = "bold 22px monospace";
      ctx.fillText(`${myHarvest}`, bx + bw - 49, by + 120);

      // Floating "+4 HARVEST!" popup
      if (Math.floor(t) % 4 >= 2) {
        const popY = by + 32 - ((t % 1) * 14);
        drawRoundedRect(W / 2 - 95, popY, 190, 32, 16, "#059669", "#a7f3d0", 2);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🔥 4-SEED HARVEST! +4", W / 2, popY + 20);
      }

      // Pointer hand tapping bottom row
      if (activePit < 6) {
        drawPointerHand(fromPt.x, fromPt.y + 18, frac < 0.35);
      }
    };

    /* ── 2. GHANA LUDO GAMEPLAY RENDERER ── */
    const renderLudoGameplay = (t: number, W: number, H: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#17112b");
      bg.addColorStop(1, "#090714");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const boardSize = 240;
      const bx = W / 2 - boardSize / 2 - 60;
      const by = 76;

      drawRoundedRect(bx, by, boardSize, boardSize, 18, "#f8fafc", "#fbbf24", 3);

      // 4 colored home bases
      drawRoundedRect(bx + 8, by + 8, 86, 86, 10, "#dc2626");
      drawRoundedRect(bx + boardSize - 94, by + 8, 86, 86, 10, "#16a34a");
      drawRoundedRect(bx + 8, by + boardSize - 94, 86, 86, 10, "#0284c7");
      drawRoundedRect(bx + boardSize - 94, by + boardSize - 94, 86, 86, 10, "#eab308");

      // Center Home Crown
      drawRoundedRect(bx + 98, by + 98, 44, 44, 8, "#1e293b", "#fbbf24", 2);
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("👑", bx + 120, by + 127);

      // Animated Red Token hopping along track
      const pathPoints = [
        { x: bx + 35, y: by + 118 },
        { x: bx + 65, y: by + 118 },
        { x: bx + 95, y: by + 118 },
        { x: bx + 118, y: by + 85 },
        { x: bx + 118, y: by + 55 },
        { x: bx + 145, y: by + 118 },
        { x: bx + 120, y: by + 120 },
      ];
      const stepIdx = Math.floor(t * 1.8) % pathPoints.length;
      const nextIdx = (stepIdx + 1) % pathPoints.length;
      const frac = (t * 1.8) % 1;
      const tx =
        pathPoints[stepIdx].x + (pathPoints[nextIdx].x - pathPoints[stepIdx].x) * frac;
      const ty =
        pathPoints[stepIdx].y +
        (pathPoints[nextIdx].y - pathPoints[stepIdx].y) * frac -
        Math.sin(frac * Math.PI) * 18;

      ctx.beginPath();
      ctx.arc(tx, ty, 13, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // Right-side 3D Blue Dice Card
      const dx = bx + boardSize + 44;
      const dy = by + 35;
      drawRoundedRect(dx, dy, 165, 170, 22, "#0f172a", "rgba(56,189,248,0.5)", 2);
      const diceRoll = (Math.floor(t * 1.5) % 6) + 1;
      drawRoundedRect(dx + 47, dy + 22, 70, 70, 16, "#0284c7", "#bae6fd", 2.5);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 36px monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(diceRoll === 5 ? 6 : diceRoll), dx + 82, dy + 69);

      ctx.fillStyle = "#fde047";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(
        stepIdx === 4 ? "💥 KICK! BONUS ROLL!" : "🎲 3D BLUE DICE • ROLL 6",
        dx + 82,
        dy + 122
      );
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px sans-serif";
      ctx.fillText("2–4 Players • Safe Stars ★", dx + 82, dy + 144);

      drawPointerHand(dx + 82, dy + 72, frac < 0.3);
    };

    /* ── 3. GHANAIAN DAME (8×8 DRAUGHTS) RENDERER ── */
    const renderDameGameplay = (t: number, W: number, H: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#071f1e");
      bg.addColorStop(1, "#040f10");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const bSize = 236;
      const cell = bSize / 6;
      const bx = W / 2 - bSize / 2;
      const by = 78;

      drawRoundedRect(bx - 8, by - 8, bSize + 16, bSize + 16, 16, "#451a03", "#f59e0b", 3);

      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = (r + c) % 2 === 1 ? "#3b1d0a" : "#fde68a";
          ctx.fillRect(bx + c * cell, by + r * cell, cell, cell);
        }
      }

      // Opponent piece being jumped
      const jumpProgress = (t % 4) / 4;
      const oppAlive = jumpProgress < 0.55;
      if (oppAlive) {
        ctx.beginPath();
        ctx.arc(bx + 2.5 * cell, by + 2.5 * cell, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#e11d48";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#fecdd3";
        ctx.stroke();
      }

      // Player Gold piece jumping diagonally to back row & crowning King
      const startX = bx + 1.5 * cell;
      const startY = by + 3.5 * cell;
      const midX = bx + 3.5 * cell;
      const midY = by + 1.5 * cell;
      const kingX = bx + 4.5 * cell;
      const kingY = by + 0.5 * cell;

      let px = startX;
      let py = startY;
      if (jumpProgress < 0.5) {
        const p = jumpProgress * 2;
        px = startX + (midX - startX) * p;
        py = startY + (midY - startY) * p - Math.sin(p * Math.PI) * 26;
      } else {
        const p = (jumpProgress - 0.5) * 2;
        px = midX + (kingX - midX) * p;
        py = midY + (kingY - midY) * p - Math.sin(p * Math.PI) * 24;
      }

      ctx.beginPath();
      ctx.arc(px, py, 15, 0, Math.PI * 2);
      ctx.fillStyle = "#f59e0b";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fef08a";
      ctx.stroke();

      if (jumpProgress > 0.75) {
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("👑", px, py + 5);
        drawRoundedRect(W / 2 - 105, by - 22, 210, 28, 14, "#10b981", "#a7f3d0", 2);
        ctx.fillStyle = "#022c22";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("👑 DOUBLE CHOP + KING CROWNED!", W / 2, by - 4);
      }
    };

    /* ── 4. 8-BALL POOL LANDSCAPE PRO RENDERER ── */
    const renderPoolGameplay = (t: number, W: number, H: number) => {
      ctx.fillStyle = "#061325";
      ctx.fillRect(0, 0, W, H);

      const tx = 95;
      const ty = 80;
      const tw = W - 190;
      const th = 230;

      // Mahogany rails & Championship Blue felt
      drawRoundedRect(tx - 14, ty - 14, tw + 28, th + 28, 26, "#5c260c", "#fbbf24", 3);
      const felt = ctx.createRadialGradient(
        tx + tw / 2,
        ty + th / 2,
        20,
        tx + tw / 2,
        ty + th / 2,
        tw * 0.6
      );
      felt.addColorStop(0, "#1d8cd8");
      felt.addColorStop(1, "#0d5287");
      drawRoundedRect(tx, ty, tw, th, 16, felt, "#bae6fd", 1.5);

      // 6 Pockets
      const pockets = [
        [tx + 6, ty + 6],
        [tx + tw / 2, ty + 4],
        [tx + tw - 6, ty + 6],
        [tx + 6, ty + th - 6],
        [tx + tw / 2, ty + th - 4],
        [tx + tw - 6, ty + th - 6],
      ];
      pockets.forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#020617";
        ctx.fill();
      });

      const cycle = (t % 4) / 4; // 0..0.45 aim, 0.45..1.0 shot
      const cueStartX = tx + 135;
      const cueStartY = ty + 135;
      const eightStartX = tx + tw - 145;
      const eightStartY = ty + 78;
      const pocketX = tx + tw - 10;
      const pocketY = ty + 10;

      let cueX = cueStartX;
      let cueY = cueStartY;
      let eightX = eightStartX;
      let eightY = eightStartY;
      let eightPotted = false;

      if (cycle < 0.48) {
        // Laser aim line + ghost ball + cue stick pullback
        const pull = Math.sin((cycle / 0.48) * Math.PI) * 32;
        const ang = Math.atan2(eightStartY - cueStartY, eightStartX - cueStartX);

        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cueStartX, cueStartY);
        ctx.lineTo(eightStartX - Math.cos(ang) * 20, eightStartY - Math.sin(ang) * 20);
        ctx.lineTo(pocketX, pocketY);
        ctx.stroke();
        ctx.restore();

        // Cue stick
        ctx.save();
        ctx.translate(cueStartX, cueStartY);
        ctx.rotate(ang + Math.PI);
        drawRoundedRect(18 + pull, -3.5, 130, 7, 3, "#fde68a", "#78350f", 1.5);
        ctx.restore();
      } else {
        const shotP = Math.min(1, (cycle - 0.48) / 0.52);
        if (shotP < 0.4) {
          const p = shotP / 0.4;
          cueX = cueStartX + (eightStartX - 20 - cueStartX) * p;
          cueY = cueStartY + (eightStartY + 10 - cueStartY) * p;
        } else {
          const p = (shotP - 0.4) / 0.6;
          cueX = eightStartX - 20 + p * 25;
          cueY = eightStartY + 10 + p * 35;
          eightX = eightStartX + (pocketX - eightStartX) * p;
          eightY = eightStartY + (pocketY - eightStartY) * p;
          if (p > 0.92) eightPotted = true;
        }
      }

      // Draw White Cue Ball
      ctx.beginPath();
      ctx.arc(cueX, cueY, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // Draw Black 8-Ball
      if (!eightPotted) {
        ctx.beginPath();
        ctx.arc(eightX, eightY, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#090d16";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("8", eightX, eightY + 3);
      } else {
        drawRoundedRect(W / 2 - 95, ty + 18, 190, 30, 15, "#10b981", "#ffffff", 2);
        ctx.fillStyle = "#022c22";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🎱 8-BALL POTTED! WIN!", W / 2, ty + 37);
      }
    };

    /* ── 5. MARKET SLASH (FRUIT SLASH 60s BLITZ) RENDERER ── */
    const renderSlashGameplay = (t: number, W: number, H: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2b160d");
      bg.addColorStop(1, "#120905");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Wood plank lines
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      for (let x = 110; x < W; x += 115) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }

      const phase = (t % 3.2) / 3.2;
      const fruits = [
        { emoji: "🍉", x0: 190, x1: 310, peak: 115, color: "#ff4d63" },
        { emoji: "🍊", x0: 360, x1: 420, peak: 100, color: "#ffa62b" },
        { emoji: "🥝", x0: 540, x1: 470, peak: 125, color: "#9be03a" },
      ];

      const sliced = phase > 0.48;

      fruits.forEach((f) => {
        const fx = f.x0 + (f.x1 - f.x0) * phase;
        const fy = 330 - Math.sin(phase * Math.PI) * (330 - f.peak);

        if (sliced) {
          // Juice splat
          ctx.beginPath();
          ctx.arc(fx, fy, 26, 0, Math.PI * 2);
          ctx.fillStyle = f.color + "55";
          ctx.fill();

          const split = (phase - 0.48) * 75;
          ctx.font = "34px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(f.emoji, fx - split, fy + split * 0.5);
          ctx.fillText(f.emoji, fx + split, fy + split * 0.5);
        } else {
          ctx.font = "40px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(f.emoji, fx, fy);
        }
      });

      // Sparking bomb to dodge on right
      const bombX = 635;
      const bombY = 330 - Math.sin(phase * Math.PI) * 165;
      ctx.font = "36px sans-serif";
      ctx.fillText("💣", bombX, bombY);

      // Glowing Cyan-Gold Katana Blade Swipe
      if (phase > 0.36 && phase < 0.68) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(160, 210);
        ctx.quadraticCurveTo(360, 95, 555, 165);
        ctx.strokeStyle = "#fffbeb";
        ctx.lineWidth = 7;
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.restore();

        drawRoundedRect(W / 2 - 105, 86, 210, 32, 16, "#ea580c", "#fde047", 2);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🔥 3× CRITICAL SLICE! +30", W / 2, 107);
      }
    };

    /* ── 6. CANDY CRASH (ALEWA & KUBE MATCH-3) RENDERER ── */
    const renderCandyGameplay = (t: number, W: number, H: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2e1018");
      bg.addColorStop(1, "#120609");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cols = 6;
      const rows = 4;
      const cell = 52;
      const gx = W / 2 - (cols * cell) / 2;
      const gy = 92;

      drawRoundedRect(
        gx - 12,
        gy - 12,
        cols * cell + 24,
        rows * cell + 24,
        20,
        "#3b180c",
        "#fbbf24",
        3
      );

      const sweets = ["🍬", "🥥", "🍫", "🥜", "🌺", "🍩"];
      const cycle = (t % 3.5) / 3.5;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = gx + c * cell + cell / 2;
          const cy = gy + r * cell + cell / 2;
          const isMatchRow = r === 1 && c >= 1 && c <= 4;

          drawRoundedRect(
            gx + c * cell + 3,
            gy + r * cell + 3,
            cell - 6,
            cell - 6,
            12,
            isMatchRow && cycle > 0.45 ? "rgba(251,191,36,0.35)" : "rgba(255,255,255,0.06)",
            isMatchRow && cycle > 0.45 ? "#fbbf24" : "rgba(255,255,255,0.12)",
            1.5
          );

          ctx.font = "26px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const emoji = isMatchRow ? "🍫" : sweets[(r * cols + c) % sweets.length];
          ctx.fillText(emoji, cx, cy);
        }
      }

      if (cycle > 0.45) {
        drawRoundedRect(W / 2 - 125, gy - 20, 250, 30, 15, "#e11d48", "#fde047", 2);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("🇬🇭 KENTE BOOSTER BLAST! +240", W / 2, gy - 1);
      } else {
        drawPointerHand(gx + 2.5 * cell, gy + 1.5 * cell, true);
      }
    };

    /* ── 7. LABADI BEACH & ABURI BUGGY GP (3D LANDSCAPE + 3-WAY STEERING) ── */
    const renderBuggyGameplay = (t: number, W: number, H: number) => {
      // Sky & Atlantic Ocean horizon
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.48);
      sky.addColorStop(0, "#0284c7");
      sky.addColorStop(0.7, "#38bdf8");
      sky.addColorStop(1, "#fde047");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H * 0.48);

      // Beach sand ground
      const sand = ctx.createLinearGradient(0, H * 0.48, 0, H);
      sand.addColorStop(0, "#d97706");
      sand.addColorStop(1, "#78350f");
      ctx.fillStyle = sand;
      ctx.fillRect(0, H * 0.48, W, H * 0.52);

      // Perspective 3D Road
      const horizonY = H * 0.46;
      const curve = Math.sin(t * 1.4) * 55;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 42 + curve, horizonY);
      ctx.lineTo(W / 2 + 42 + curve, horizonY);
      ctx.lineTo(W / 2 + 250, H);
      ctx.lineTo(W / 2 - 250, H);
      ctx.closePath();
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#facc15";
      ctx.stroke();

      // Animated Kente Boost Pad on road
      const padProgress = (t * 0.75) % 1;
      const padY = horizonY + padProgress * (H - horizonY - 60);
      const padW = 36 + padProgress * 110;
      drawRoundedRect(W / 2 - padW / 2 + curve * (1 - padProgress), padY, padW, 14, 4, "#facc15", "#ef4444", 2);

      // Player Buggy with Shito Nitro Flame
      const carX = W / 2 + Math.sin(t * 2.1) * 48;
      const carY = H - 108;
      drawRoundedRect(carX - 38, carY - 24, 76, 42, 12, "#ef4444", "#fde047", 2.5);
      ctx.font = "34px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🏎️", carX, carY + 4);

      // Nitro twin flames
      ctx.beginPath();
      ctx.arc(carX - 14, carY + 22, 8 + Math.sin(t * 20) * 3, 0, Math.PI * 2);
      ctx.arc(carX + 14, carY + 22, 8 + Math.cos(t * 20) * 3, 0, Math.PI * 2);
      ctx.fillStyle = "#38bdf8";
      ctx.fill();

      // Left Interactive Steering Wheel HUD preview
      const wx = 108;
      const wy = H - 115;
      const steerRad = Math.sin(t * 2.1) * 0.65;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(steerRad);
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#f59e0b";
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(34, 0);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 34);
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#cbd5e1";
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#fde047";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("🛞 WHEEL / 📱 TILT / ◀▶", wx, wy + 52);

      // Right N2 Nitro button preview
      drawRoundedRect(W - 148, H - 145, 86, 56, 16, "#ea580c", "#fde047", 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("🔥 NITRO", W - 105, H - 112);
    };

    const renderFrame = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      if (isPlayingRef.current) {
        elapsedRef.current += dt;
        if (elapsedRef.current >= VIDEO_DURATION_SECONDS) {
          if (autoNextRef.current) {
            elapsedRef.current = 0;
            handleAdvanceToNextGame();
          } else {
            elapsedRef.current = 0;
          }
        }
        setElapsedSec(elapsedRef.current);
      }

      const t = elapsedRef.current;
      const W = canvas.width;
      const H = canvas.height;
      const currentGame = gameTypeRef.current;
      const currentGuide = GAME_STEP_GUIDES[currentGame] || GAME_STEP_GUIDES.oware;
      const chapIdx = Math.min(3, Math.floor((t / VIDEO_DURATION_SECONDS) * 4));
      const stepObj = currentGuide.steps[chapIdx] || currentGuide.steps[0];

      ctx.clearRect(0, 0, W, H);

      if (currentGame === "oware") renderOwareGameplay(t, W, H);
      else if (currentGame === "ludo") renderLudoGameplay(t, W, H);
      else if (currentGame === "dame") renderDameGameplay(t, W, H);
      else if (currentGame === "pool") renderPoolGameplay(t, W, H);
      else if (currentGame === "slash") renderSlashGameplay(t, W, H);
      else if (currentGame === "candy") renderCandyGameplay(t, W, H);
      else renderBuggyGameplay(t, W, H);

      // ── TOP CINEMA OVERLAY BAR ──
      const topGrad = ctx.createLinearGradient(0, 0, 0, 64);
      topGrad.addColorStop(0, "rgba(2, 6, 23, 0.92)");
      topGrad.addColorStop(1, "rgba(2, 6, 23, 0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, 64);

      // Live Gameplay Pill
      drawRoundedRect(16, 12, 152, 28, 14, "rgba(220, 38, 38, 0.9)", "#fca5a5", 1.5);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("● LIVE GAMEPLAY DEMO", 28, 30);

      // Game Title in Top Center
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${currentGuide.emoji} ${currentGuide.title}`, W / 2, 30);

      // Step Chapter Badge Top Right
      drawRoundedRect(W - 142, 12, 126, 28, 14, "rgba(245, 158, 11, 0.95)", "#fef08a", 1.5);
      ctx.fillStyle = "#090d16";
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`STEP 0${chapIdx + 1} OF 04`, W - 79, 30);

      // ── BOTTOM CAPTION / SUBTITLE OVERLAY BAR ──
      const botGrad = ctx.createLinearGradient(0, H - 86, 0, H);
      botGrad.addColorStop(0, "rgba(2, 6, 23, 0)");
      botGrad.addColorStop(0.35, "rgba(2, 6, 23, 0.92)");
      botGrad.addColorStop(1, "rgba(2, 6, 23, 0.98)");
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, H - 86, W, 86);

      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`STEP ${stepObj.stepNum}: ${stepObj.heading.toUpperCase()}`, W / 2, H - 40);

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "12px sans-serif";
      const cleanDetail =
        stepObj.detail.length > 96 ? stepObj.detail.slice(0, 93) + "..." : stepObj.detail;
      ctx.fillText(cleanDetail, W / 2, H - 18);

      animId = requestAnimationFrame(renderFrame);
    };

    animId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animId);
  }, [handleAdvanceToNextGame]);

  const formatSec = (s: number) => {
    const whole = Math.max(0, Math.floor(s));
    return `0:${String(whole).padStart(2, "0")}`;
  };

  return (
    <div className="rounded-2xl bg-slate-950 border border-amber-500/35 overflow-hidden shadow-2xl">
      {/* Playlist Strip Starting From Oware */}
      <div className="px-3 py-2 bg-slate-900/95 border-b border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1 shrink-0 mr-1">
          <Film className="w-3.5 h-3.5" /> Gameplay Playlist:
        </span>
        {GAMEPLAY_VIDEO_ORDER.map((gId, idx) => {
          const gMeta = GAME_STEP_GUIDES[gId];
          const active = gId === gameType;
          return (
            <button
              key={gId}
              type="button"
              onClick={() => onSelectGame?.(gId)}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-black whitespace-nowrap border transition-all flex items-center gap-1 cursor-pointer shrink-0 ${
                active
                  ? "bg-amber-500 text-slate-950 border-amber-300 shadow"
                  : "bg-slate-950 text-slate-300 border-white/10 hover:text-white hover:border-white/25"
              }`}
            >
              <span className="text-[9px] font-mono opacity-75">{idx + 1}.</span>
              <span>{gMeta.emoji}</span>
              <span>{gMeta.shortName}</span>
            </button>
          );
        })}
      </div>

      {/* 16:9 Cinema Canvas Stage */}
      <div className="relative bg-black aspect-video w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          width={760}
          height={380}
          onClick={() => setIsPlaying((p) => !p)}
          className="w-full h-full object-cover cursor-pointer block"
        />

        {!isPlaying && (
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            className="absolute inset-0 bg-black/45 flex items-center justify-center cursor-pointer"
          >
            <div className="w-16 h-16 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.7)]">
              <Play className="w-8 h-8 fill-current ml-1" />
            </div>
          </button>
        )}
      </div>

      {/* Video Timeline Scrubber + 4 Step Chapter Buttons */}
      <div className="p-3 bg-slate-900/95 border-t border-white/10 space-y-2.5">
        {/* Progress Scrubber Bar */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="w-8 h-8 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center cursor-pointer shrink-0 shadow"
            title={isPlaying ? "Pause Video" : "Play Video"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          </button>

          <button
            type="button"
            onClick={() => {
              elapsedRef.current = 0;
              setElapsedSec(0);
              setIsPlaying(true);
            }}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            title="Restart Video"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Clickable Timeline Track */}
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              elapsedRef.current = ratio * VIDEO_DURATION_SECONDS;
              setElapsedSec(elapsedRef.current);
            }}
            className="relative flex-1 h-2.5 rounded-full bg-slate-800 overflow-hidden cursor-pointer"
          >
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 transition-all duration-75"
              style={{ width: `${Math.min(100, (elapsedSec / VIDEO_DURATION_SECONDS) * 100)}%` }}
            />
            {/* Chapter dividers at 25%, 50%, 75% */}
            {[25, 50, 75].map((pct) => (
              <span
                key={pct}
                className="absolute top-0 bottom-0 w-0.5 bg-slate-950/80"
                style={{ left: `${pct}%` }}
              />
            ))}
          </div>

          <span className="text-[11px] font-mono font-bold text-slate-300 shrink-0">
            {formatSec(elapsedSec)} / {formatSec(VIDEO_DURATION_SECONDS)}
          </span>
        </div>

        {/* 4 Step Jump Pills + Actions */}
        {!compact && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {guide.steps.map((st, idx) => {
                const isChap = activeChapterIdx === idx;
                return (
                  <button
                    key={st.stepNum}
                    type="button"
                    onClick={() => {
                      elapsedRef.current = idx * 4 + 0.05;
                      setElapsedSec(elapsedRef.current);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer ${
                      isChap
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-slate-950 border-white/10 text-slate-400 hover:text-white"
                    }`}
                  >
                    Step {st.stepNum}: {st.heading.split(" ").slice(0, 3).join(" ")}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevGame}
                className="h-7 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3 h-3" /> Prev
              </button>
              <button
                type="button"
                onClick={handleNextGame}
                className="h-7 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                Next Game <ChevronRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setAutoNextPlaylist((a) => !a)}
                className={`h-7 px-2.5 rounded-lg border text-[10px] font-black cursor-pointer ${
                  autoNextPlaylist
                    ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
                    : "bg-slate-950 border-white/10 text-slate-400"
                }`}
              >
                Auto-All: {autoNextPlaylist ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                disabled={isRecordingWebm}
                onClick={handleDownloadGameplayVideo}
                className="h-7 px-2.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-[10px] font-black text-sky-300 flex items-center gap-1 cursor-pointer"
                title="Download 8s WebM Gameplay Video"
              >
                <Download className="w-3 h-3" />
                {isRecordingWebm ? "Recording..." : "Save Video"}
              </button>
              {onPlayGameNow && (
                <button
                  type="button"
                  onClick={() => onPlayGameNow(gameType)}
                  className="h-7 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black flex items-center gap-1 cursor-pointer shadow"
                >
                  Play {guide.shortName} <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active Step Tip Box */}
        <div className="p-2.5 rounded-xl bg-slate-950/90 border border-white/10 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Badge className="bg-amber-500 text-slate-950 font-black text-[10px] shrink-0">
              STEP {activeStepInfo.stepNum}
            </Badge>
            <span className="font-bold text-white truncate">{activeStepInfo.heading}</span>
            <span className="hidden md:inline text-slate-400 truncate">
              — 💡 {activeStepInfo.tip}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameInstructionPromptModal({
  gameType,
  open,
  onSkip,
  onStartGame,
}: {
  gameType: ArenaGameType;
  open: boolean;
  onSkip: () => void;
  onStartGame: () => void;
}) {
  const [activeVideoGame, setActiveVideoGame] = useState<ArenaGameType>(gameType || "oware");
  const [mode, setMode] = useState<"choice" | "steps">("choice");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setActiveVideoGame(gameType || "oware");
      setMode("choice");
      setStepIdx(0);
    }
  }, [open, gameType]);

  if (!open) return null;

  const guide = GAME_STEP_GUIDES[activeVideoGame] || GAME_STEP_GUIDES.oware;
  const currentStep = guide.steps[stepIdx] || guide.steps[0];

  return (
    <div className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-slate-950 border-2 border-amber-500/50 shadow-[0_25px_70px_rgba(0,0,0,0.9)] text-white">
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/50 border-b border-white/10 flex items-center justify-between gap-3 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${guide.accentGradient} flex items-center justify-center text-xl shadow-lg`}
            >
              {guide.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black">
                  {guide.badge}
                </Badge>
                <span className="text-[10px] font-bold text-emerald-400">
                  🎬 Live Gameplay Video &amp; Guide
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-black text-white">{guide.title}</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body with Embedded Live Gameplay Video Player */}
        <div className="p-4 sm:p-5 space-y-4">
          <GameplayVideoPlayer
            gameType={activeVideoGame}
            onSelectGame={(nextG) => {
              setActiveVideoGame(nextG);
              setStepIdx(0);
            }}
            onPlayGameNow={() => onStartGame()}
          />

          {mode === "choice" ? (
            <>
              {/* 4 Mini Step Pills Preview */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {guide.steps.map((s, idx) => (
                  <button
                    key={s.stepNum}
                    type="button"
                    onClick={() => {
                      setStepIdx(idx);
                      setMode("steps");
                    }}
                    className="p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-white/10 hover:border-amber-400/50 text-left transition-all cursor-pointer"
                  >
                    <span className="text-[10px] font-mono font-black text-amber-400">
                      STEP {s.stepNum}
                    </span>
                    <p className="text-xs font-bold text-white line-clamp-1 mt-0.5">
                      {s.heading}
                    </p>
                  </button>
                ))}
              </div>

              {/* Primary Choice Buttons: Skip vs Follow Steps */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onSkip}
                  className="h-11 rounded-2xl border-white/20 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs gap-2"
                >
                  <FastForward className="w-4 h-4 text-amber-400" />
                  Skip &amp; Play Now
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    setStepIdx(0);
                    setMode("steps");
                  }}
                  className={`h-11 rounded-2xl bg-gradient-to-r ${guide.accentGradient} text-slate-950 font-black text-xs gap-2 shadow-lg`}
                >
                  <BookOpen className="w-4 h-4" />
                  Read Detailed Steps (1 → 4)
                </Button>
              </div>
            </>
          ) : (
            /* Step-by-Step Interactive Walkthrough */
            <div className="space-y-3">
              {/* Step Progress Indicators */}
              <div className="grid grid-cols-4 gap-2">
                {guide.steps.map((s, i) => {
                  const active = i === stepIdx;
                  const done = i < stepIdx;
                  return (
                    <button
                      key={s.stepNum}
                      type="button"
                      onClick={() => setStepIdx(i)}
                      className={`p-2 rounded-xl border text-center transition-all cursor-pointer ${
                        active
                          ? "bg-amber-500/20 border-amber-400 text-amber-300 font-black"
                          : done
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-bold"
                          : "bg-slate-900 border-white/10 text-slate-400"
                      }`}
                    >
                      <span className="text-[10px] font-mono block">Step {s.stepNum}</span>
                    </button>
                  );
                })}
              </div>

              {/* Active Step Card */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-amber-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                    STEP {currentStep.stepNum} OF 04
                  </Badge>
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-[11px] font-bold text-slate-400 hover:text-amber-300 underline cursor-pointer"
                  >
                    Close Guide →
                  </button>
                </div>

                <h4 className="text-sm sm:text-base font-black text-white">
                  {currentStep.heading}
                </h4>
                <p className="text-xs text-slate-200 leading-relaxed">{currentStep.detail}</p>

                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>Pro Tip:</strong> {currentStep.tip}
                  </span>
                </div>
              </div>

              {/* Step Footer Navigation */}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={stepIdx === 0}
                  onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
                  className="h-9 rounded-xl border-white/15 bg-slate-900 text-white text-xs font-bold gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>

                <div className="flex items-center gap-2">
                  {stepIdx < guide.steps.length - 1 ? (
                    <Button
                      type="button"
                      onClick={() => setStepIdx((s) => s + 1)}
                      className="h-9 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-1"
                    >
                      Next Step <ChevronRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={onStartGame}
                      className="h-9 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5 shadow-lg"
                    >
                      Got It — Play Now! <ArrowRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PRO_STEPS = [
  {
    id: 0,
    num: "01",
    shortTitle: "Select Game",
    title: "Choose Your Arena Game (Starting with Ghana Oware)",
    description:
      "Watch live gameplay videos starting from Ghana Oware, Ludo, Dame, 8-Ball Pool, Market Slash, Candy Crash & Labadi Buggy GP!",
    bullets: [
      "Ghana Oware (#1 Popular): Authentic Nam-Nam continuous relay sowing & 4-seed harvest.",
      "Ghana Ludo, Dame & 8-Ball Pool: 3D Dice Ludo, mandatory jump Draughts & Landscape Billiards.",
      "Market Slash, Candy Crash & Buggy GP: 60s Blitz slicing, 75s Alewa Match-3 & 3D Landscape Racing.",
    ],
    icon: Gamepad2,
    accent: "amber",
    gradient: "from-amber-500 to-orange-500",
    ctaLabel: "Play Selected Game",
  },
  {
    id: 1,
    num: "02",
    shortTitle: "Pick Mode",
    title: "Select How You Want to Compete",
    description:
      "Compete live against another user, play immediately against our 91%–95% Human-Sense Champions, or accumulate points in the Free Data Arena.",
    bullets: [
      "Open 1v1 Lobby: Post a challenge room (auto-notifies all users) or invite a friend directly.",
      "Human-Sense Mode (1.8×): Play vs Medium-Difficulty Ghanaian Champions for a 1.8× cash payout.",
      "Free Data Mode: Win timed matches (+35 Pts) toward your 1GB, 2GB, or 5GB Free Data target!",
    ],
    icon: Users,
    accent: "emerald",
    gradient: "from-emerald-500 to-teal-500",
    ctaLabel: "Try Free Data Mode",
  },
  {
    id: 2,
    num: "03",
    shortTitle: "Fund Stake",
    title: "Stake via Wallet Balance or Mobile Money",
    description:
      "All stakes are held safely in automated escrow during the match and settled the second the game ends.",
    bullets: [
      "SwiftData Wallet: Instant 1-click deduction from your account balance (GH₵2 – GH₵200).",
      "Mobile Money (MoMo): Pay seamlessly via Paystack (MTN, Telecel, or AirtelTigo).",
      "100% Cancel Refund: Cancel any unjoined Open 1v1 room to get an instant full wallet refund.",
    ],
    icon: Wallet,
    accent: "indigo",
    gradient: "from-indigo-500 to-blue-500",
    ctaLabel: "Set Your Stake",
  },
  {
    id: 3,
    num: "04",
    shortTitle: "Claim Prize",
    title: "Win Instant Cash or Target Free Data Bundles",
    description:
      "As soon as your match ends or your target points bar hits 100%, claim your reward with zero manual delay.",
    bullets: [
      "1.8× Cash Payout: Credited directly into your SwiftData Wallet balance upon victory.",
      "Target Data Bundles: Unlock 1GB (5,000 Pts), 2GB (9,500 Pts), or 5GB (20,000 Pts) Free Data!",
      "Instant Delivery: Dispatch your won Free Data reward directly to any Ghanaian phone number.",
    ],
    icon: Trophy,
    accent: "purple",
    gradient: "from-purple-500 to-pink-500",
    ctaLabel: "Start Playing Now",
  },
];

const STEP_DURATION_MS = 5000;

export function ChallengeHowItWorks({ onQuickStart }: ChallengeHowItWorksProps) {
  const [expanded, setExpanded] = useState(true);
  const [viewTab, setViewTab] = useState<"video" | "steps">("video");
  const [activeStep, setActiveStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [progress, setProgress] = useState(0);
  // Default strictly to "oware" first as requested!
  const [activeGameDemo, setActiveGameDemo] = useState<ArenaGameType>("oware");
  const [demoFrame, setDemoFrame] = useState(0);

  // Smooth 60fps-like progress bar + auto-step advance
  useEffect(() => {
    if (!expanded || viewTab !== "steps" || !autoPlay) return;
    const interval = 50;
    const increment = (interval / STEP_DURATION_MS) * 100;

    const timer = window.setInterval(() => {
      setProgress((prev) => {
        if (prev + increment >= 100) {
          setActiveStep((s) => (s + 1) % PRO_STEPS.length);
          return 0;
        }
        return prev + increment;
      });
    }, interval);

    return () => window.clearInterval(timer);
  }, [expanded, viewTab, autoPlay]);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => {
      setDemoFrame((f) => (f + 1) % 7);
    }, 900);
    return () => window.clearInterval(timer);
  }, [expanded]);

  const handleSelectStep = (idx: number) => {
    setActiveStep(idx);
    setProgress(0);
    setAutoPlay(false);
  };

  const currentStep = PRO_STEPS[activeStep];

  return (
    <div className="rounded-3xl bg-slate-950/95 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.75)] overflow-hidden">
      {/* ── Top Studio Control Bar ── */}
      <div className="px-4 sm:px-6 py-3.5 bg-gradient-to-r from-slate-900 via-slate-900/95 to-amber-950/50 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-950 shadow-md">
            <Film className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                🎬 Gameplay Video Showcase
              </span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className="text-[10px] font-bold text-emerald-400">
                Starting from Ghana Oware → All 7 Arena Games
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
              Watch How Every Game Is Played (Oware, Ludo, Dame, Pool, Slash, Candy &amp; Buggy GP)
            </h2>
          </div>
        </div>

        {/* Center Mode Switcher + Right Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {expanded && (
            <div className="inline-flex items-center rounded-xl bg-slate-950/90 p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setViewTab("video")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewTab === "video"
                    ? "bg-amber-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                Gameplay Videos
              </button>
              <button
                type="button"
                onClick={() => setViewTab("steps")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                  viewTab === "steps"
                    ? "bg-amber-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                4-Step Arena Flow
              </button>
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((e) => !e)}
            className="h-8 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-white gap-1"
          >
            {expanded ? (
              <>
                Hide Videos <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Watch Gameplay Videos <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="p-4 sm:p-6 space-y-5"
          >
            {viewTab === "video" ? (
              <div className="space-y-4">
                <GameplayVideoPlayer
                  gameType={activeGameDemo}
                  onSelectGame={(nextG) => setActiveGameDemo(nextG)}
                  onPlayGameNow={(g) => onQuickStart?.(g, "free_data")}
                />

                {/* 4 Step Cards Below the Video Player */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {GAME_STEP_GUIDES[activeGameDemo].steps.map((st) => (
                    <div
                      key={st.stepNum}
                      className="p-3.5 rounded-2xl bg-slate-900/90 border border-amber-500/25 space-y-1.5"
                    >
                      <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono">
                        STEP {st.stepNum}
                      </Badge>
                      <p className="text-xs font-black text-white">{st.heading}</p>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{st.detail}</p>
                      <p className="text-[10px] text-emerald-300 font-semibold pt-1">
                        💡 {st.tip}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* ── Connected Horizontal Stepper Pipeline (01 ── 02 ── 03 ── 04) ── */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {PRO_STEPS.map((s, idx) => {
                    const Icon = s.icon;
                    const isActive = activeStep === idx;
                    const isCompleted = activeStep > idx;

                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSelectStep(idx)}
                        className={`group relative p-3.5 rounded-2xl border text-left transition-all overflow-hidden cursor-pointer ${
                          isActive
                            ? "bg-slate-900 border-amber-400/70 shadow-[0_10px_30px_rgba(245,158,11,0.15)]"
                            : isCompleted
                            ? "bg-slate-900/60 border-emerald-500/30 hover:border-emerald-500/50"
                            : "bg-slate-900/40 border-white/10 hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-7 h-7 rounded-lg font-mono text-xs font-black flex items-center justify-center transition-all ${
                                isActive
                                  ? `bg-gradient-to-br ${s.gradient} text-slate-950 shadow`
                                  : isCompleted
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                            </span>
                            <span
                              className={`text-xs font-black ${
                                isActive ? "text-white" : "text-slate-300"
                              }`}
                            >
                              {s.shortTitle}
                            </span>
                          </div>
                          <Icon
                            className={`w-4 h-4 ${
                              isActive
                                ? "text-amber-400"
                                : isCompleted
                                ? "text-emerald-400"
                                : "text-slate-500"
                            }`}
                          />
                        </div>

                        <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden mt-2">
                          <div
                            className={`h-full transition-all duration-75 ${
                              isActive
                                ? "bg-gradient-to-r from-amber-400 to-emerald-400"
                                : isCompleted
                                ? "bg-emerald-500 w-full"
                                : "w-0"
                            }`}
                            style={isActive ? { width: `${progress}%` } : undefined}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* ── Main Split Showcase Stage ── */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900/90 border border-white/10">
                  <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`bg-gradient-to-r ${currentStep.gradient} text-slate-950 font-black text-[10px] px-2.5 py-0.5`}
                        >
                          STEP {currentStep.num} OF 04
                        </Badge>
                        <span className="text-xs font-bold text-slate-400">
                          {currentStep.shortTitle}
                        </span>
                      </div>

                      <h3 className="text-lg sm:text-xl font-black text-white leading-tight">
                        {currentStep.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        {currentStep.description}
                      </p>

                      <ul className="space-y-2 pt-1">
                        {currentStep.bullets.map((b, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-xs text-slate-200 leading-snug"
                          >
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10">
                      <Button
                        size="sm"
                        onClick={() => onQuickStart?.(activeGameDemo, "free_data")}
                        className={`h-9 px-4 rounded-xl bg-gradient-to-r ${currentStep.gradient} text-slate-950 font-black text-xs gap-1 shadow`}
                      >
                        {currentStep.ctaLabel} <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="lg:col-span-7 rounded-2xl bg-slate-950 border border-white/10 p-3 flex flex-col justify-center">
                    <GameplayVideoPlayer
                      gameType={activeGameDemo}
                      onSelectGame={(nextG) => setActiveGameDemo(nextG)}
                      compact={true}
                    />
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
