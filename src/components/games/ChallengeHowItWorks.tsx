import { useState, useEffect } from "react";
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
  Crown,
  ShieldCheck,
  ArrowRight,
  Zap,
  FastForward,
  BookOpen,
  X,
} from "lucide-react";

export type ArenaGameType = "oware" | "ludo" | "dame" | "pool" | "slash" | "candy";

interface ChallengeHowItWorksProps {
  onQuickStart?: (game: ArenaGameType, mode: "p2p" | "ai" | "free_data") => void;
}

interface GameStepGuide {
  title: string;
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
  candy: {
    title: "Candy Crash (Sweet Cascade Arena)",
    tagline: "Swap candies to match 3+, forge Striped Candies & Chocolate Sprinkle Bombs!",
    emoji: "🍬",
    badge: "✨ Match-3 Puzzle",
    accentGradient: "from-pink-500 to-amber-500",
    steps: [
      {
        stepNum: "01",
        heading: "Swipe or Tap Adjacent Candies to Swap",
        detail:
          "Drag any candy toward a neighbor (or tap two adjacent candies) to line up 3 or more matching colors horizontally or vertically.",
        tip: "Look near the bottom of the 8×8 board first — bottom matches trigger free falling cascades!",
      },
      {
        stepNum: "02",
        heading: "Match 4 to Forge a Striped Candy",
        detail:
          "Matching 4 candies in a row or column creates a glowing Striped Candy. Matching it blasts an entire row or column!",
        tip: "Swap two Striped Candies together to trigger an instant Row + Column Cross Blast!",
      },
      {
        stepNum: "03",
        heading: "Match 5 for a Chocolate Sprinkle Bomb",
        detail:
          "Matching 5 candies creates a Chocolate Sprinkle Bomb. Swap it with any candy color to wipe out every candy of that color on the board!",
        tip: "Save your Chocolate Bomb for the most common color on the board for massive combo points.",
      },
      {
        stepNum: "04",
        heading: "Reach the Target Score Before Moves Run Out",
        detail:
          "Hit the level goal with 8+ moves left to earn 3 Stars (★★★) and bonus Arena Points toward your Free Data Bundle!",
        tip: "Stuck? Tap the Hint button at the bottom to pulse a valid move.",
      },
    ],
  },
  slash: {
    title: "Market Slash (Makola & Kejetia Edition)",
    tagline: "Swipe fast across the wooden board to slice fruits, build combos & dodge bombs!",
    emoji: "🍉",
    badge: "🔪 Swipe Action",
    accentGradient: "from-amber-500 to-orange-600",
    steps: [
      {
        stepNum: "01",
        heading: "Swipe Across Flying Market Fruits",
        detail:
          "Drag your finger or mouse quickly across Watermelons, Papayas (Pawpaw), and Pineapples tossed up from the market stall.",
        tip: "Short, quick swipes give you the cleanest blade arc!",
      },
      {
        stepNum: "02",
        heading: "Slice Multi-Fruit Combos (+20 / +30 Pts)",
        detail:
          "Cut 2, 3, or 4 fruits in a single swipe to trigger a COMBO multiplier and paint juicy splatters on the cutting board.",
        tip: "Wait until fruits peak together at the top of their arc for easy 3x combos.",
      },
      {
        stepNum: "03",
        heading: "Clear All 5 Market Stalls (+150 to +750 Bonus)",
        detail:
          "Advance from 1/5 Morning Market → 2/5 Busy Stall → 3/5 Rush Hour → 4/5 Kejetia Peak → 5/5 Makola Finale!",
        tip: "Every stall cleared awards a huge confetti point bonus + Arena Level points.",
      },
      {
        stepNum: "04",
        heading: "Dodge Sparking Bombs & Avoid 3 Misses",
        detail:
          "Never slice a sparking black Bomb (instant Game Over!) and don't let 3 unsliced fruits drop off the bottom of the board.",
        tip: "Watch closely when bombs hide behind big watermelons!",
      },
    ],
  },
  pool: {
    title: "8-Ball Pool (Landscape Pro)",
    tagline: "Turn your phone sideways, aim with the cue laser &Gyro sensor, and sink the 8-Ball!",
    emoji: "🎱",
    badge: "📱 Rotate Phone",
    accentGradient: "from-sky-500 to-blue-600",
    steps: [
      {
        stepNum: "01",
        heading: "Rotate Phone Sideways & Aim Cue Laser",
        detail:
          "Drag on the Championship Blue table (or use the Fine-Tune buttons / Gyro Tilt Sensor) to align the dual-circle ghost ball sight.",
        tip: "Tap the Gyro Tilt button if you want phone-tilt micro-aiming!",
      },
      {
        stepNum: "02",
        heading: "Set Cue Spin & Pull Back Power Slider",
        detail:
          "Adjust the Cue Spin pad on the left, then drag down the Right Power Meter (15%–100%) and release to strike.",
        tip: "Use softer power (35%–55%) on thin cut shots so the cue ball doesn't scratch.",
      },
      {
        stepNum: "03",
        heading: "Claim Solids (1–7) or Stripes (9–15)",
        detail:
          "The first ball legally potted after the break locks in your group. Pot a ball to keep your turn (+40 Arena Pts per ball!).",
        tip: "If the cue ball drops in a pocket, your opponent gets Ball-in-Hand.",
      },
      {
        stepNum: "04",
        heading: "Sink the Black 8-Ball Last to Win",
        detail:
          "Once all 7 of your group balls are cleared, sink the Black 8-Ball to win the match and +300 Arena Points!",
        tip: "Never pot the 8-Ball early — that is an instant loss of frame.",
      },
    ],
  },
  oware: {
    title: "Ghana Oware (Nam-Nam & Abapa)",
    tagline: "Authentic 12-bowl Akan hinged ebony & terracotta board with continuous relay sowing!",
    emoji: "🪨",
    badge: "Most Popular",
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
        tip: "Each harvested seed earns +15 Arena Points toward your Free Data goal.",
      },
      {
        stepNum: "04",
        heading: "Capture 25+ Seeds to Win",
        detail:
          "Outscore your opponent (or Nana Kwame Asante • 93% Human Sense) by capturing 25 or more seeds into your Kulo storehouse!",
        tip: "Count your opponent's seeds before sowing so you don't feed them a 4-seed bowl.",
      },
    ],
  },
  ludo: {
    title: "Ghana Ludo (Pro 52-Cell • 2–4 Players)",
    tagline: "Official 52-cell track, 4 tokens in Base, 8 Safe Squares, Blockades & invite up to 3 friends!",
    emoji: "🎲",
    badge: "🎲 2–4 Players",
    accentGradient: "from-rose-500 to-amber-500",
    steps: [
      {
        stepNum: "01",
        heading: "Roll 6 on the 3D Blue Dice to Launch from Base",
        detail:
          "All 4 tokens begin inside your Base. Roll a 6 to move a token onto your colored starting cell and earn an extra turn (3 consecutive 6s forfeits your turn)!",
        tip: "You can also switch between 2P, 3P, or 4P and invite friends to Green, Yellow, or Blue!",
      },
      {
        stepNum: "02",
        heading: "52-Cell Circuit, Captures & 8 Protected Safe Squares",
        detail:
          "Move clockwise around all 52 main-track cells. Land on an opponent token on a non-safe square to send it back to Base and earn a Bonus Roll (+50 Arena Pts!).",
        tip: "The 4 Starting squares and 4 Star (★) squares are safe from capture.",
      },
      {
        stepNum: "03",
        heading: "Form Blockades (🛡️ 2+ Tokens) & Choose Every Move",
        detail:
          "Stack 2 or more of your tokens on the same square to form a Blockade that opponents cannot pass or land on. Whenever multiple moves exist, YOU choose which token to move!",
        tip: "Use a Blockade on a choke point to trap opponent runners behind you.",
      },
      {
        stepNum: "04",
        heading: "Bring All 4 Tokens Home by Exact Roll (+300 Pts)",
        detail:
          "After completing a full 51-step circuit, enter your private 6-cell Home Path and bring all 4 tokens into the Center Home Triangle by exact dice roll to win!",
        tip: "Overshooting the final home triangle is not allowed — wait for the exact dice number.",
      },
    ],
  },
  dame: {
    title: "Ghanaian Dame (8×8 Draughts)",
    tagline: "Classic Ghanaian checkers with mandatory diagonal jump captures and Crowned Kings!",
    emoji: "♟️",
    badge: "Pure Skill",
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
          "Whenever an opponent piece can be jumped diagonally (forward or backward), the jump capture is mandatory (+45 Arena Pts!).",
        tip: "Chain multiple jumps together to clear your opponent's defense.",
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
          "Capture all opponent pieces or block them from making any legal move to claim victory and +300 Arena Points!",
        tip: "Control the center squares to restrict Kofi Mensah's movement.",
      },
    ],
  },
};

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
  const [mode, setMode] = useState<"choice" | "steps">("choice");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setMode("choice");
      setStepIdx(0);
    }
  }, [open, gameType]);

  if (!open) return null;

  const guide = GAME_STEP_GUIDES[gameType] || GAME_STEP_GUIDES.slash;
  const currentStep = guide.steps[stepIdx] || guide.steps[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-3xl bg-slate-950 border-2 border-amber-500/50 shadow-[0_25px_70px_rgba(0,0,0,0.9)] overflow-hidden text-white">
        {/* Top Modal Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/50 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${guide.accentGradient} flex items-center justify-center text-2xl shadow-lg`}
            >
              {guide.emoji}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black">
                  {guide.badge}
                </Badge>
                <span className="text-[10px] font-bold text-emerald-400">
                  Quick Game Instructions
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-black text-white">{guide.title}</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Skip Instructions"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {mode === "choice" ? (
            <>
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-white/10 space-y-2">
                <p className="text-xs sm:text-sm text-slate-200 font-semibold leading-relaxed">
                  {guide.tagline}
                </p>
                <p className="text-[11px] text-amber-300/90">
                  Would you like to follow the quick 4-step walkthrough for{" "}
                  <strong>{guide.title}</strong>, or skip straight to setup &amp; play?
                </p>
              </div>

              {/* 4 Mini Step Pills Preview */}
              <div className="grid grid-cols-2 gap-2">
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
                  className="h-12 rounded-2xl border-white/20 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs gap-2"
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
                  className={`h-12 rounded-2xl bg-gradient-to-r ${guide.accentGradient} text-slate-950 font-black text-xs gap-2 shadow-lg`}
                >
                  <BookOpen className="w-4 h-4" />
                  Follow Steps (1 → 4)
                </Button>
              </div>
            </>
          ) : (
            /* Step-by-Step Interactive Walkthrough */
            <div className="space-y-4">
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
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-amber-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                    STEP {currentStep.stepNum} OF 04
                  </Badge>
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-[11px] font-bold text-slate-400 hover:text-amber-300 underline cursor-pointer"
                  >
                    Skip Instructions →
                  </button>
                </div>

                <h4 className="text-base sm:text-lg font-black text-white">
                  {currentStep.heading}
                </h4>
                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                  {currentStep.detail}
                </p>

                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    <strong>Pro Tip:</strong> {currentStep.tip}
                  </span>
                </div>
              </div>

              {/* Step Footer Navigation */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={stepIdx === 0}
                  onClick={() => setStepIdx((s) => Math.max(0, s - 1))}
                  className="h-10 rounded-xl border-white/15 bg-slate-900 text-white text-xs font-bold gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onSkip}
                    className="h-10 rounded-xl text-xs font-bold text-slate-300 hover:text-white"
                  >
                    Skip
                  </Button>

                  {stepIdx < guide.steps.length - 1 ? (
                    <Button
                      type="button"
                      onClick={() => setStepIdx((s) => s + 1)}
                      className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-1"
                    >
                      Next Step <ChevronRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={onStartGame}
                      className="h-10 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5 shadow-lg"
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
    title: "Choose Your Arena Game (Market Slash, Pool, Oware, Ludo & Dame)",
    description:
      "Pick any of our 5 Pro games — including Market Slash (swipe fruits & dodge bombs!) and Landscape 8-Ball Pool!",
    bullets: [
      "Market Slash (NEW!): Slice Watermelons, Papayas & Pineapples across 5 Ghanaian market stalls while dodging bombs.",
      "8-Ball Pool (Landscape Pro): Turn your phone sideways! Aim the cue laser, control power & sink the 8-Ball.",
      "Ghana Oware, Ludo & Dame: Authentic Nam-Nam 4-seed harvest, 3D Blue Dice Ludo & 8×8 Draughts.",
    ],
    icon: Gamepad2,
    accent: "amber",
    gradient: "from-amber-500 to-orange-500",
    ctaLabel: "Choose Game Below",
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
      "Free Data Mode: Accumulate Arena Points across levels toward your 1GB, 2GB, or 5GB Free Data target!",
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
      "Target Data Bundles: Unlock 1GB (1,000 Pts), 2GB (2,000 Pts), or 5GB (4,500 Pts) Free Data!",
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
  const [viewTab, setViewTab] = useState<"steps" | "rules">("steps");
  const [activeStep, setActiveStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [progress, setProgress] = useState(0);
  const [activeGameDemo, setActiveGameDemo] = useState<ArenaGameType>("slash");
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

  // Continuous animation frame counter for the visual canvas
  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => {
      setDemoFrame((f) => (f + 1) % 5);
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
      <div className="px-4 sm:px-6 py-3.5 bg-gradient-to-r from-slate-900 via-slate-900/95 to-indigo-950/60 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-950 shadow-md">
            <Sparkles className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                Interactive Onboarding
              </span>
              <span className="w-1 h-1 rounded-full bg-white/30" />
              <span className="text-[10px] font-bold text-emerald-400">
                Tap Any Game to Follow Steps or Skip
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
              How to Participate &amp; Win in the Challenge Arena
            </h2>
          </div>
        </div>

        {/* Center Mode Switcher + Right Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {expanded && (
            <div className="inline-flex items-center rounded-xl bg-slate-950/90 p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setViewTab("steps")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                  viewTab === "steps"
                    ? "bg-amber-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                4-Step Challenge Flow
              </button>
              <button
                type="button"
                onClick={() => setViewTab("rules")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                  viewTab === "rules"
                    ? "bg-amber-500 text-slate-950 shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                Game Rules Simulator
              </button>
            </div>
          )}

          {expanded && viewTab === "steps" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAutoPlay((a) => !a)}
              className="h-8 px-2.5 text-xs text-slate-300 hover:text-white gap-1.5 border border-white/10 rounded-xl"
            >
              {autoPlay ? (
                <Pause className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Play className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="hidden sm:inline">{autoPlay ? "Pause" : "Auto-Play"}</span>
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((e) => !e)}
            className="h-8 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-white gap-1"
          >
            {expanded ? (
              <>
                Minimize <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Show Step-by-Step Guide <ChevronDown className="w-3.5 h-3.5" />
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
            className="p-4 sm:p-6 space-y-6"
          >
            {viewTab === "steps" ? (
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
                        className={`group relative p-3.5 rounded-2xl border text-left transition-all overflow-hidden ${
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

                        {/* Smooth Progress Fill Bar */}
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
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.22 }}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900/90 border border-white/10"
                  >
                    {/* Left Column: Step Breakdown & Action (5 cols) */}
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

                      {/* Step Navigation Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10">
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleSelectStep(
                                (activeStep - 1 + PRO_STEPS.length) % PRO_STEPS.length
                              )
                            }
                            className="h-8 w-8 p-0 rounded-lg border-white/15 bg-slate-900 text-white"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleSelectStep((activeStep + 1) % PRO_STEPS.length)
                            }
                            className="h-8 px-3 rounded-lg border-white/15 bg-slate-900 text-xs font-bold text-white gap-1"
                          >
                            Next Step <ChevronRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => {
                            if (activeStep === 1) onQuickStart?.(activeGameDemo, "free_data");
                            else onQuickStart?.(activeGameDemo, "p2p");
                          }}
                          className={`h-8 px-3.5 rounded-lg bg-gradient-to-r ${currentStep.gradient} text-slate-950 font-black text-xs gap-1 shadow`}
                        >
                          {currentStep.ctaLabel} <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Right Column: Live Animated Visual Stage (7 cols) */}
                    <div className="lg:col-span-7 rounded-2xl bg-slate-950 border border-white/10 p-4 sm:p-5 flex flex-col justify-center relative overflow-hidden min-h-[230px]">
                      {/* STEP 01 VISUAL: 5 Game Cards with Animated Focus Ring */}
                      {activeStep === 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                              Live Game Selection Preview — Tap any card to view steps or play
                            </span>
                            <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">
                              5 Pro Arena Games
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            {[
                              {
                                id: "slash" as const,
                                name: "Market Slash",
                                sub: "Slice Fruit & Bombs",
                                badge: "🍉 NEW",
                                img: null,
                                emoji: "🍉",
                              },
                              {
                                id: "pool" as const,
                                name: "8-Ball Pool",
                                sub: "Rotate Phone Sideways",
                                badge: "📱 Landscape",
                                img: "/pool-challenge-icon.jpg",
                                emoji: "🎱",
                              },
                              {
                                id: "oware" as const,
                                name: "Ghana Oware",
                                sub: "Nam-Nam Relay",
                                badge: "Popular",
                                img: "/oware-challenge-icon.jpg",
                                emoji: "🪨",
                              },
                              {
                                id: "ludo" as const,
                                name: "Ghana Ludo",
                                sub: "3D Blue Dice & Kick",
                                badge: "Fast Action",
                                img: "/ludo-challenge-icon.png",
                                emoji: "🎲",
                              },
                              {
                                id: "dame" as const,
                                name: "Ghana Dame",
                                sub: "8×8 Draughts",
                                badge: "Pure Skill",
                                img: null,
                                emoji: "♟️",
                              },
                            ].map((g, idx) => {
                              const focused = demoFrame % 5 === idx;
                              return (
                                <motion.div
                                  key={g.id}
                                  animate={{
                                    scale: focused ? 1.03 : 1,
                                    y: focused ? -3 : 0,
                                  }}
                                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                                  onClick={() => {
                                    setActiveGameDemo(g.id);
                                    onQuickStart?.(g.id, "p2p");
                                  }}
                                  className={`p-3 rounded-2xl border cursor-pointer transition-colors relative ${
                                    focused
                                      ? "bg-gradient-to-b from-amber-500/20 to-slate-900 border-amber-400 shadow-[0_8px_25px_rgba(245,158,11,0.2)]"
                                      : "bg-slate-900/70 border-white/10 hover:border-white/25"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    {g.img ? (
                                      <img
                                        src={g.img}
                                        alt={g.name}
                                        className="w-9 h-9 rounded-xl object-cover border border-white/20 shadow"
                                      />
                                    ) : (
                                      <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-lg">
                                        {g.emoji}
                                      </div>
                                    )}
                                    <Badge
                                      className={`text-[8px] font-black px-1.5 ${
                                        focused
                                          ? "bg-amber-400 text-slate-950"
                                          : "bg-slate-800 text-slate-300"
                                      }`}
                                    >
                                      {focused ? "✓ Active" : g.badge}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] font-black text-white truncate">{g.name}</p>
                                  <p className="text-[9px] text-slate-400 mt-0.5 truncate">{g.sub}</p>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* STEP 02 VISUAL: 3 Match Modes Pipeline */}
                      {activeStep === 1 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                              Choose Your Arena Mode
                            </span>
                            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px]">
                              Real-Time Sync
                            </Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                              {
                                mode: "p2p" as const,
                                title: "Open 1v1 PvP",
                                tag: "Room Code #GH842K",
                                desc: "Create or join a live table & notify all users via SMS/Web.",
                                icon: Users,
                                color: "text-amber-400 border-amber-400 bg-amber-500/15",
                              },
                              {
                                mode: "ai" as const,
                                title: "Human Sense (1.8×)",
                                tag: "Medium Difficulty",
                                desc: "Play vs 91%–95% Human-Sense Champions for 1.8× cash.",
                                icon: Sparkles,
                                color: "text-emerald-400 border-emerald-400 bg-emerald-500/15",
                              },
                              {
                                mode: "free_data" as const,
                                title: "Free Data Arena",
                                tag: "1GB / 2GB / 5GB",
                                desc: "Accumulate Arena Points across levels to unlock Free Data!",
                                icon: Gift,
                                color: "text-purple-400 border-purple-400 bg-purple-500/15",
                              },
                            ].map((m, idx) => {
                              const MIcon = m.icon;
                              const active = demoFrame % 3 === idx;
                              return (
                                <motion.div
                                  key={m.mode}
                                  animate={{ scale: active ? 1.03 : 1 }}
                                  onClick={() => onQuickStart?.(activeGameDemo, m.mode)}
                                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                                    active
                                      ? m.color
                                      : "bg-slate-900/70 border-white/10 text-slate-300"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <MIcon className="w-5 h-5" />
                                    <span className="text-[9px] font-mono font-black px-2 py-0.5 rounded-full bg-black/40 border border-white/10">
                                      {m.tag}
                                    </span>
                                  </div>
                                  <p className="text-xs font-black text-white">{m.title}</p>
                                  <p className="text-[10px] text-slate-300 mt-1 leading-snug">
                                    {m.desc}
                                  </p>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* STEP 03 VISUAL: Escrow Payment Flow Diagram */}
                      {activeStep === 2 && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                              Automated Stake Escrow Architecture
                            </span>
                            <Badge className="bg-indigo-500/20 text-indigo-300 border border-indigo-400/40 text-[10px] gap-1">
                              <ShieldCheck className="w-3 h-3" /> 100% Protected
                            </Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                            <div className="space-y-2">
                              <div
                                className={`p-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${
                                  demoFrame % 2 === 0
                                    ? "bg-emerald-500/15 border-emerald-400"
                                    : "bg-slate-900 border-white/10"
                                }`}
                              >
                                <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
                                <div>
                                  <p className="text-[11px] font-black text-white">Wallet Balance</p>
                                  <p className="text-[9px] text-slate-400">1-Click Instant</p>
                                </div>
                              </div>
                              <div
                                className={`p-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${
                                  demoFrame % 2 === 1
                                    ? "bg-amber-500/15 border-amber-400"
                                    : "bg-slate-900 border-white/10"
                                }`}
                              >
                                <Smartphone className="w-4 h-4 text-amber-400 shrink-0" />
                                <div>
                                  <p className="text-[11px] font-black text-white">Paystack MoMo</p>
                                  <p className="text-[9px] text-slate-400">MTN • Telecel • AT</p>
                                </div>
                              </div>
                            </div>

                            <div className="p-3.5 rounded-2xl bg-indigo-950/50 border-2 border-indigo-400/60 text-center space-y-1 shadow-lg">
                              <ShieldCheck className="w-6 h-6 text-indigo-300 mx-auto animate-pulse" />
                              <p className="text-[10px] font-bold uppercase text-indigo-300">
                                Escrow Pot Locked
                              </p>
                              <p className="text-base font-black text-white font-mono">
                                GH₵ 20.00
                              </p>
                              <span className="text-[9px] text-slate-400 block">
                                Held safely during match
                              </span>
                            </div>

                            <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-center space-y-1">
                              <Trophy className="w-6 h-6 text-amber-400 mx-auto" />
                              <p className="text-[10px] font-bold uppercase text-emerald-300">
                                Winner Payout
                              </p>
                              <p className="text-base font-black text-emerald-400 font-mono">
                                GH₵ 18.00
                              </p>
                              <span className="text-[9px] text-slate-400 block">
                                Instant Wallet / Data
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* STEP 04 VISUAL: Instant Cash or Data Bundle Conversion */}
                      {activeStep === 3 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                              Dual Winner Reward Options
                            </span>
                            <Badge className="bg-emerald-500 text-slate-950 font-black text-[10px]">
                              Instant Settlement
                            </Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div
                              className={`p-4 rounded-2xl border transition-all ${
                                demoFrame % 2 === 0
                                  ? "bg-emerald-950/60 border-emerald-400 shadow-lg"
                                  : "bg-slate-900/70 border-white/10"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px]">
                                  Option 1 • Cash Prize
                                </Badge>
                                <Wallet className="w-4 h-4 text-emerald-400" />
                              </div>
                              <p className="text-base font-black text-white font-mono">
                                +GH₵ 18.00 Credited
                              </p>
                              <p className="text-[11px] text-slate-300 mt-1">
                                Automatically added to your SwiftData Wallet the moment you win a staked match.
                              </p>
                            </div>

                            <div
                              className={`p-4 rounded-2xl border transition-all ${
                                demoFrame % 2 === 1
                                  ? "bg-purple-950/60 border-purple-400 shadow-lg"
                                  : "bg-slate-900/70 border-white/10"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <Badge className="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px]">
                                  Option 2 • Target Data Bundle
                                </Badge>
                                <Gift className="w-4 h-4 text-purple-400" />
                              </div>
                              <p className="text-base font-black text-white">
                                🎁 1GB / 2GB / 5GB Data Bundle
                              </p>
                              <p className="text-[11px] text-slate-300 mt-1">
                                Enter any MTN, Telecel, or AirtelTigo number to dispatch your data bundle reward!
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </>
            ) : (
              /* ── TAB 2: PRO INTERACTIVE GAME RULES SIMULATOR ── */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: "slash", label: "🍉 Market Slash (Fruit & Bombs)" },
                        { id: "pool", label: "🎱 8-Ball Pool (Landscape)" },
                        { id: "oware", label: "🪨 Ghana Oware (Nam-Nam)" },
                        { id: "ludo", label: "🎲 Ghana Ludo (Kick)" },
                        { id: "dame", label: "♟️ Ghanaian Dame" },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveGameDemo(tab.id)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-black border transition-all ${
                          activeGameDemo === tab.id
                            ? "bg-amber-500 text-slate-950 border-amber-400 shadow"
                            : "bg-slate-900 border-white/10 text-slate-300 hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <Button
                    size="sm"
                    onClick={() => onQuickStart?.(activeGameDemo, "p2p")}
                    className="h-9 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5"
                  >
                    Play {activeGameDemo.toUpperCase()} Now <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Game-Specific Visual Simulator Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-white/10">
                  <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {GAME_STEP_GUIDES[activeGameDemo].steps.map((st) => (
                      <div
                        key={st.stepNum}
                        className="p-3.5 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-1.5"
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
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
