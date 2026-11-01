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
} from "lucide-react";

interface ChallengeHowItWorksProps {
  onQuickStart?: (game: "oware" | "ludo" | "dame" | "pool", mode: "p2p" | "ai" | "free_data") => void;
}

const PRO_STEPS = [
  {
    id: 0,
    num: "01",
    shortTitle: "Select Game",
    title: "Choose Your Arena Game (Oware, Ludo, 8-Ball Pool & Dame)",
    description:
      "Pick any of our 4 iconic games — including our Landscape 8-Ball Pool where you turn your phone sideways for full cue-laser precision!",
    bullets: [
      "Ghana Oware & Ludo: Authentic Nam-Nam 4-seed harvest & 15×15 4-corner Ludo with 3D Blue Dice.",
      "8-Ball Pool (Landscape Pro): Turn your phone sideways! Aim the cue laser, control power & sink the 8-Ball.",
      "Ghanaian Dame: 8×8 draughts with mandatory diagonal jump captures & Crowned Kings.",
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
      "Compete live against another user, play immediately against the Grandmaster AI, or enter the Daily Free Data Arena.",
    bullets: [
      "Open 1v1 Lobby: Post a challenge room or join a waiting player using a 6-digit Room Code.",
      "Instant AI (1.8×): Zero waiting — challenge the Grandmaster AI for a 1.8× cash payout.",
      "Free Data Mode: GH₵0.00 entry fee — defeat the Grandmaster AI to claim free data bundles.",
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
    title: "Win Instant Cash or Data Bundles",
    description:
      "As soon as the winning move is played, your reward is unlocked automatically with zero manual delay.",
    bullets: [
      "1.8× Cash Payout: Credited directly into your SwiftData Wallet balance upon victory.",
      "Convert to Data Bundle: Swap your cash winnings into MTN, Telecel, or AirtelTigo data.",
      "Free Data Delivery: Dispatch your won Free Data reward directly to any Ghanaian phone number.",
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
  const [activeGameDemo, setActiveGameDemo] = useState<"oware" | "ludo" | "dame">("oware");
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
      setDemoFrame((f) => (f + 1) % 6);
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
              <span className="text-[10px] font-bold text-emerald-400">30-Second Visual Guide</span>
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
              {autoPlay ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
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

                {/* ── Main Split Showcase Stage (Left: Executive Details, Right: Interactive Animated Canvas) ── */}
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
                      {/* STEP 01 VISUAL: 3 Game Cards with Animated Focus Ring */}
                      {activeStep === 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                              Live Game Selection Preview — Tap any card to select
                            </span>
                            <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px]">
                              4 Pro Arena Games
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            {[
                              {
                                id: "oware" as const,
                                name: "Ghana Oware",
                                sub: "Nam-Nam Relay & Abapa",
                                badge: "Popular",
                                img: "/oware-challenge-icon.jpg",
                              },
                              {
                                id: "ludo" as const,
                                name: "Ghana Ludo",
                                sub: "3D Blue Dice & Kick",
                                badge: "Fast Action",
                                img: "/ludo-challenge-icon.png",
                              },
                              {
                                id: "pool" as const,
                                name: "8-Ball Pool",
                                sub: "Rotate Phone Sideways",
                                badge: "📱 Landscape",
                                img: "/pool-challenge-icon.jpg",
                              },
                              {
                                id: "dame" as const,
                                name: "Ghanaian Dame",
                                sub: "8×8 Draughts & Kings",
                                badge: "Pure Skill",
                                img: null,
                              },
                            ].map((g, idx) => {
                              const focused = demoFrame % 4 === idx;
                              return (
                                <motion.div
                                  key={g.id}
                                  animate={{
                                    scale: focused ? 1.03 : 1,
                                    y: focused ? -3 : 0,
                                  }}
                                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                                  onClick={() => {
                                    if (g.id !== "pool") setActiveGameDemo(g.id);
                                    onQuickStart?.(g.id, "p2p");
                                  }}
                                  className={`p-3.5 rounded-2xl border cursor-pointer transition-colors relative ${
                                    focused
                                      ? "bg-gradient-to-b from-amber-500/20 to-slate-900 border-amber-400 shadow-[0_8px_25px_rgba(245,158,11,0.2)]"
                                      : "bg-slate-900/70 border-white/10 hover:border-white/25"
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-2.5">
                                    {g.img ? (
                                      <img
                                        src={g.img}
                                        alt={g.name}
                                        className="w-10 h-10 rounded-xl object-cover border border-white/20 shadow"
                                      />
                                    ) : (
                                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-xl">
                                        ♟️
                                      </div>
                                    )}
                                    <Badge
                                      className={`text-[9px] font-black ${
                                        focused
                                          ? "bg-amber-400 text-slate-950"
                                          : "bg-slate-800 text-slate-300"
                                      }`}
                                    >
                                      {focused ? "✓ Active" : g.badge}
                                    </Badge>
                                  </div>
                                  <p className="text-xs font-black text-white">{g.name}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">{g.sub}</p>
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
                                desc: "Create or join a live table & share code on WhatsApp.",
                                icon: Users,
                                color: "text-amber-400 border-amber-400 bg-amber-500/15",
                              },
                              {
                                mode: "ai" as const,
                                title: "Instant AI (1.8×)",
                                tag: "Zero Wait Time",
                                desc: "Play vs Grandmaster AI immediately for 1.8× cash.",
                                icon: Sparkles,
                                color: "text-emerald-400 border-emerald-400 bg-emerald-500/15",
                              },
                              {
                                mode: "free_data" as const,
                                title: "Free Data Arena",
                                tag: "GH₵0.00 Entry",
                                desc: "Beat the Grandmaster AI to win a 1GB Data Bundle!",
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
                            {/* Funding Sources */}
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

                            {/* Center Escrow Vault */}
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

                            {/* Winner Release */}
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
                                  Option 2 • Data Bundle
                                </Badge>
                                <Gift className="w-4 h-4 text-purple-400" />
                              </div>
                              <p className="text-base font-black text-white">
                                🎁 1GB Free Data Bundle
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
              /* ── TAB 2: PRO INTERACTIVE GAME RULES SIMULATOR (Oware • Ludo • Dame) ── */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {(
                      [
                        { id: "oware", label: "🪨 Ghana Oware (Nam-Nam & Abapa)" },
                        { id: "ludo", label: "🎲 Ghana Ludo (Kick Edition)" },
                        { id: "dame", label: "♟️ Ghanaian Dame (Draughts)" },
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
                  {/* Left: 3 Rule Cards (6 cols) */}
                  <div className="lg:col-span-6 space-y-2.5">
                    {activeGameDemo === "oware" && (
                      <>
                        <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30">
                          <p className="text-xs font-black text-amber-400">
                            1. Counter-Clockwise Nam-Nam Relay Sowing
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Tap any of your 6 terracotta bowls to scoop all seeds and drop them one-by-one counter-clockwise. If your last seed lands in a bowl that already has seeds, you scoop them up and continue sowing!
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30">
                          <p className="text-xs font-black text-emerald-400">
                            2. The 4-Seed Harvest Rule (+4 🔥)
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Whenever any bowl reaches <strong>4 seeds</strong> during sowing, the row owner harvests them. If your <strong>very last seed</strong> makes 4 in ANY bowl, <strong>YOU capture those 4 seeds</strong>!
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-white/10">
                          <p className="text-xs font-black text-white">
                            3. Abapa Tournament Switcher Available
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Prefer international tournament rules? Toggle <strong>🏆 Abapa (2/3 Capture)</strong> at the top of the Oware board before the first move.
                          </p>
                        </div>
                      </>
                    )}

                    {activeGameDemo === "ludo" && (
                      <>
                        <div className="p-3 rounded-xl bg-slate-950 border border-indigo-500/30">
                          <p className="text-xs font-black text-indigo-400">
                            1. Roll 6 on the 3D Blue Dice to Deploy
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Each player starts with 1 active token on their ★ Start square and 3 in the Yard. Roll a <strong>6</strong> to deploy a token from your Yard and earn a <strong>Bonus Roll</strong>!
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-red-500/30">
                          <p className="text-xs font-black text-red-400">
                            2. Kick Opponent Tokens Back to Yard (💥)
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Land on an opponent&apos;s token outside the 4 ★ Safe Star squares to kick it back to their Yard and earn an immediate Bonus Roll!
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30">
                          <p className="text-xs font-black text-emerald-400">
                            3. Race 2 Tokens into Center Home (🏠)
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            First player to guide <strong>2 tokens</strong> up their colored Home Stretch into the Center Triangle wins!
                          </p>
                        </div>
                      </>
                    )}

                    {activeGameDemo === "dame" && (
                      <>
                        <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30">
                          <p className="text-xs font-black text-amber-400">
                            1. Diagonal Movement on Dark Squares
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Tap any glowing piece to highlight its valid diagonal moves in green, then tap the target square.
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-rose-500/30">
                          <p className="text-xs font-black text-rose-400">
                            2. Mandatory Jump Capture (&quot;Chop&quot;)
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Whenever an opponent piece can be jumped diagonally (forward or backward), the jump is <strong>mandatory</strong>!
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30">
                          <p className="text-xs font-black text-emerald-400">
                            3. Crowned Kings (👑)
                          </p>
                          <p className="text-[11px] text-slate-300 mt-0.5">
                            Reach the far back row to crown your piece a King that moves and captures in all 4 diagonal directions.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right: Live Animated Board Simulation Stage (6 cols) */}
                  <div className="lg:col-span-6 p-4 rounded-2xl bg-slate-950 border border-white/10">
                    {activeGameDemo === "oware" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-orange-300">
                            Live Sowing Demo (Hinged Ebony &amp; Terracotta Bowls)
                          </span>
                          <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                            {demoFrame < 4
                              ? `✋ Dropping seed in Bowl #${(demoFrame % 4) + 1}`
                              : "🔥 Bowl #4 reached 4 seeds → +4 Harvest!"}
                          </Badge>
                        </div>
                        <div className="p-3 rounded-3xl bg-[#18191c] border-2 border-[#34363c] grid grid-cols-4 gap-3">
                          {[0, 1, 2, 3].map((idx) => {
                            const active = demoFrame % 4 === idx;
                            const harvested = idx === 3 && demoFrame >= 3;
                            const seeds = harvested ? 4 : idx === 0 && demoFrame > 0 ? 0 : 3 + (demoFrame > idx ? 1 : 0);
                            return (
                              <div
                                key={idx}
                                className={`aspect-square rounded-full flex flex-col items-center justify-center relative border-2 transition-all ${
                                  harvested
                                    ? "border-amber-300 ring-4 ring-amber-400/50 scale-105"
                                    : active
                                    ? "border-emerald-400 scale-105"
                                    : "border-[#2d1206]"
                                }`}
                                style={{
                                  background:
                                    "radial-gradient(circle at 36% 30%, #e06d34 0%, #c64f18 55%, #4a1502 100%)",
                                }}
                              >
                                <span className="text-xs sm:text-sm font-black text-white font-mono">
                                  {harvested ? "+4🔥" : seeds}
                                </span>
                                <span className="text-[9px] text-amber-200/80 font-mono">
                                  Bowl #{idx + 1}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeGameDemo === "ludo" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-indigo-300">
                            Live 15×15 Track &amp; 3D Blue Dice Demo
                          </span>
                          <Badge className="bg-indigo-600 text-white font-black text-[10px]">
                            {demoFrame % 2 === 0 ? "🎲 Rolled 6 → Bonus Turn!" : "💥 Kicked Yellow Token!"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-5 gap-2 p-3 rounded-2xl bg-[#eef6fb] border-2 border-slate-400">
                          {[0, 1, 2, 3, 4].map((step) => {
                            const redHere = demoFrame % 5 === step;
                            return (
                              <div
                                key={step}
                                className={`h-14 rounded-xl border flex flex-col items-center justify-center relative ${
                                  step === 0
                                    ? "bg-[#dc2626] text-white"
                                    : step === 4
                                    ? "bg-[#15803d] text-white"
                                    : "bg-white text-slate-800"
                                }`}
                              >
                                {redHere ? (
                                  <span className="w-7 h-7 rounded-full bg-red-600 border-2 border-white shadow-md flex items-center justify-center text-xs font-black text-white animate-bounce">
                                    R1
                                  </span>
                                ) : step === 3 ? (
                                  <span className="w-6 h-6 rounded-full bg-yellow-400 border border-slate-900 flex items-center justify-center text-[10px] font-black text-slate-950">
                                    Y1
                                  </span>
                                ) : (
                                  <span className="text-xs font-black opacity-75">
                                    {step === 0 ? "★ START" : step === 4 ? "🏠 HOME" : `Step ${step}`}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeGameDemo === "dame" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-amber-300">
                            Live Mandatory Jump (&quot;Chop&quot;) &amp; King Demo
                          </span>
                          <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                            {demoFrame % 2 === 0 ? "Select Gold Piece" : "🔥 Jumped & Crowned King!"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-[#2b1408] border-2 border-[#6b3719]">
                          {[0, 1, 2].map((sq) => {
                            const jumped = demoFrame % 2 === 1;
                            return (
                              <div
                                key={sq}
                                className="h-14 rounded-xl bg-[#1a0b04] border border-amber-500/30 flex items-center justify-center"
                              >
                                {sq === 0 && !jumped && (
                                  <span className="w-8 h-8 rounded-full bg-amber-400 border-2 border-white shadow" />
                                )}
                                {sq === 1 && !jumped && (
                                  <span className="w-8 h-8 rounded-full bg-rose-600 border-2 border-rose-200 shadow" />
                                )}
                                {sq === 1 && jumped && (
                                  <span className="text-xs font-black text-amber-400">CHOP! 🔥</span>
                                )}
                                {sq === 2 && jumped && (
                                  <span className="w-9 h-9 rounded-full bg-amber-400 border-2 border-white shadow flex items-center justify-center text-slate-950 animate-bounce">
                                    <Crown className="w-4 h-4 stroke-[2.5]" />
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
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
