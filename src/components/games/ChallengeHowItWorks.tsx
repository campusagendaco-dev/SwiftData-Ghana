import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  ChevronRight,
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
} from "lucide-react";

interface ChallengeHowItWorksProps {
  onQuickStart?: (game: "oware" | "ludo" | "dame", mode: "p2p" | "ai" | "free_data") => void;
}

const WALKTHROUGH_STEPS = [
  {
    step: 1,
    title: "1. Pick a Ghanaian Traditional Game",
    subtitle: "Choose Oware (Nam-Nam / Abapa), Ghana Ludo (Kick), or Ghanaian Dame.",
    icon: Gamepad2,
    color: "from-amber-500 to-orange-500",
    border: "border-amber-500/40",
    badge: "Step 1 of 4",
  },
  {
    step: 2,
    title: "2. Choose Your Challenge Mode",
    subtitle: "Play Open 1v1 vs real players, Instant AI (1.8× cash), or Free Data Mode!",
    icon: Users,
    color: "from-emerald-500 to-teal-500",
    border: "border-emerald-500/40",
    badge: "Step 2 of 4",
  },
  {
    step: 3,
    title: "3. Stake Wallet Balance or MoMo",
    subtitle: "Use your SwiftData Wallet or Mobile Money (GH₵2–GH₵200), or play Free!",
    icon: Wallet,
    color: "from-indigo-500 to-blue-500",
    border: "border-indigo-500/40",
    badge: "Step 3 of 4",
  },
  {
    step: 4,
    title: "4. Win Cash or Claim Free Data!",
    subtitle: "Win instant Wallet Cash (1.8× payout) or 1-click Data Bundles to any network!",
    icon: Trophy,
    color: "from-purple-500 to-pink-500",
    border: "border-purple-500/40",
    badge: "Step 4 of 4",
  },
];

export function ChallengeHowItWorks({ onQuickStart }: ChallengeHowItWorksProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeStep, setActiveStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [activeGameDemo, setActiveGameDemo] = useState<"oware" | "ludo" | "dame">("oware");
  const [demoTick, setDemoTick] = useState(0);

  // Auto-advance the 4 onboarding steps every 4 seconds
  useEffect(() => {
    if (!expanded || !autoPlay) return;
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % WALKTHROUGH_STEPS.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [expanded, autoPlay]);

  // Continuous micro-animation tick for the visual stage (every 900ms)
  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => {
      setDemoTick((t) => (t + 1) % 6);
    }, 950);
    return () => window.clearInterval(timer);
  }, [expanded]);

  return (
    <div className="rounded-3xl bg-gradient-to-br from-slate-900/95 via-slate-950 to-indigo-950/40 border border-amber-500/30 shadow-2xl overflow-hidden transition-all">
      {/* Top Bar (Always Visible) */}
      <div className="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900/70">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
            <Sparkles className="w-4 h-4 animate-spin" style={{ animationDuration: "6s" }} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-black text-white">
                How to Join &amp; Win in the Challenge Arena
              </span>
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[10px] font-black">
                Interactive Animated Guide
              </Badge>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Watch the 4 quick steps below or preview how Oware, Ghana Ludo, and Dame work before you play.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {expanded && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAutoPlay((a) => !a)}
              className="h-8 text-xs text-amber-300 hover:text-amber-200 gap-1.5"
            >
              {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {autoPlay ? "Pause Tour" : "Auto-Play"}
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
                Hide Guide <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Watch Quick Steps <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* 4-Step Interactive Timeline Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {WALKTHROUGH_STEPS.map((item, idx) => {
              const Icon = item.icon;
              const isCurrent = activeStep === idx;
              return (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => {
                    setActiveStep(idx);
                    setAutoPlay(false);
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative overflow-hidden ${
                    isCurrent
                      ? `bg-slate-900 ${item.border} ring-2 ring-amber-400/60 shadow-lg scale-[1.01]`
                      : "bg-slate-950/70 border-white/10 hover:border-white/25 opacity-80 hover:opacity-100"
                  }`}
                >
                  {/* Animated Progress Bar at Bottom of Active Step */}
                  {isCurrent && autoPlay && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400 animate-pulse w-full" />
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-2">
                    <div
                      className={`w-8 h-8 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-slate-950 shadow-md`}
                    >
                      <Icon className="w-4 h-4 stroke-[2.5]" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] font-black ${
                        isCurrent
                          ? "border-amber-400 text-amber-300 bg-amber-500/10"
                          : "border-white/15 text-slate-400"
                      }`}
                    >
                      {item.badge}
                    </Badge>
                  </div>
                  <p className="text-xs font-black text-white">{item.title}</p>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">{item.subtitle}</p>
                </button>
              );
            })}
          </div>

          {/* Live Animated Stage for Current Step + Mini Game Simulator */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Left Stage: Visual Animation of the Selected Step (7 cols) */}
            <div className="lg:col-span-7 p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-white/10 flex flex-col justify-between space-y-4">
              {activeStep === 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                      STEP 1 ANIMATION • PICK YOUR GAME
                    </Badge>
                    <span className="text-[11px] text-amber-300 font-bold animate-pulse">
                      👆 Tap any game below to select it!
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 pt-1">
                    {[
                      {
                        id: "oware" as const,
                        name: "Ghana Oware",
                        tag: "Nam-Nam & Abapa",
                        img: "/oware-challenge-icon.jpg",
                        desc: "4-Seed Relay & 2/3 Capture",
                      },
                      {
                        id: "ludo" as const,
                        name: "Ghana Ludo",
                        tag: "3D Dice & Kick",
                        img: "/ludo-challenge-icon.png",
                        desc: "Roll 6, Kick & Race Home",
                      },
                      {
                        id: "dame" as const,
                        name: "Ghana Dame",
                        tag: "8×8 Draughts",
                        img: null,
                        desc: "Mandatory Jump & Kings",
                      },
                    ].map((g, idx) => {
                      const highlighted = demoTick % 3 === idx;
                      return (
                        <div
                          key={g.id}
                          onClick={() => {
                            setActiveGameDemo(g.id);
                            onQuickStart?.(g.id, "p2p");
                          }}
                          className={`p-3 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col items-center text-center ${
                            highlighted
                              ? "bg-amber-500/15 border-amber-400 scale-105 shadow-[0_0_20px_rgba(245,158,11,0.25)]"
                              : "bg-slate-900/80 border-white/10 hover:border-white/30"
                          }`}
                        >
                          {g.img ? (
                            <img
                              src={g.img}
                              alt={g.name}
                              className="w-11 h-11 rounded-xl object-cover border border-white/20 shadow mb-2"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-xl mb-2">
                              ♟️
                            </div>
                          )}
                          <p className="text-xs font-black text-white">{g.name}</p>
                          <span className="text-[9px] text-amber-300 font-bold">{g.tag}</span>
                          <p className="text-[10px] text-slate-400 mt-1">{g.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeStep === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-emerald-500 text-slate-950 font-black text-[10px]">
                      STEP 2 ANIMATION • 3 WAYS TO PLAY
                    </Badge>
                    <span className="text-[11px] text-emerald-300 font-bold">
                      Choose 1v1 PvP, Instant AI, or Free Data!
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div
                      onClick={() => onQuickStart?.(activeGameDemo, "p2p")}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                        demoTick % 3 === 0
                          ? "bg-amber-500/15 border-amber-400 scale-[1.03]"
                          : "bg-slate-900/80 border-white/10"
                      }`}
                    >
                      <Users className="w-5 h-5 text-amber-400 mb-1.5" />
                      <p className="text-xs font-black text-white">1. Open 1v1 Lobby</p>
                      <p className="text-[10px] text-slate-300 mt-1">
                        Post an open challenge or join a waiting player. Share your <strong>6-digit Room Code</strong> on WhatsApp!
                      </p>
                    </div>

                    <div
                      onClick={() => onQuickStart?.(activeGameDemo, "ai")}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                        demoTick % 3 === 1
                          ? "bg-emerald-500/15 border-emerald-400 scale-[1.03]"
                          : "bg-slate-900/80 border-white/10"
                      }`}
                    >
                      <Sparkles className="w-5 h-5 text-emerald-400 mb-1.5" />
                      <p className="text-xs font-black text-white">2. Instant AI (1.8×)</p>
                      <p className="text-[10px] text-slate-300 mt-1">
                        No waiting! Stake GH₵2–GH₵200 against the Grandmaster AI and win <strong>1.8× Cash</strong> immediately.
                      </p>
                    </div>

                    <div
                      onClick={() => onQuickStart?.(activeGameDemo, "free_data")}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                        demoTick % 3 === 2
                          ? "bg-purple-500/15 border-purple-400 scale-[1.03]"
                          : "bg-slate-900/80 border-white/10"
                      }`}
                    >
                      <Gift className="w-5 h-5 text-purple-400 mb-1.5" />
                      <p className="text-xs font-black text-white">3. Free Data Arena</p>
                      <p className="text-[10px] text-slate-300 mt-1">
                        <strong>GH₵0.00 Entry!</strong> Defeat the ruthless Grandmaster AI to claim a Free Data Bundle!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeStep === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-indigo-500 text-white font-black text-[10px]">
                      STEP 3 ANIMATION • STAKE WALLET OR MOMO
                    </Badge>
                    <span className="text-[11px] text-indigo-300 font-bold">
                      Instant Escrow Protection 🔒
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      className={`p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                        demoTick % 2 === 0
                          ? "bg-emerald-500/15 border-emerald-400 ring-1 ring-emerald-400/50"
                          : "bg-slate-900/80 border-white/10"
                      }`}
                    >
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400">
                        <Wallet className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-white">Option A: SwiftData Wallet</p>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          1-click instant entry using your account balance. If you cancel an open room before someone joins, your stake is <strong>refunded 100% instantly</strong>!
                        </p>
                      </div>
                    </div>

                    <div
                      className={`p-3.5 rounded-2xl border transition-all flex items-start gap-3 ${
                        demoTick % 2 === 1
                          ? "bg-amber-500/15 border-amber-400 ring-1 ring-amber-400/50"
                          : "bg-slate-900/80 border-white/10"
                      }`}
                    >
                      <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-white">Option B: Mobile Money (MoMo)</p>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Approve via Paystack MoMo (MTN, Telecel, or AirtelTigo). Verified on the server and locked safely in the challenge pot!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeStep === 3 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-purple-500 text-white font-black text-[10px]">
                      STEP 4 ANIMATION • INSTANT PAYOUT OR DATA BUNDLE
                    </Badge>
                    <span className="text-[11px] text-purple-300 font-bold">
                      Automatic Winner Settlement ⚡
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-amber-950/60 border border-emerald-500/40 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center shadow-lg animate-bounce">
                        <Trophy className="w-6 h-6 stroke-[2.5]" />
                      </div>
                      <div>
                        <p className="text-sm font-black text-white">
                          Stake GH₵10.00 → Win GH₵18.00 Instant Prize!
                        </p>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Cash prizes credit straight to your <strong>SwiftData Wallet</strong>, OR tap{" "}
                          <strong className="text-amber-300">&quot;Convert Prize to Data Bundle&quot;</strong> to send MTN / Telecel / AirtelTigo data to any phone number!
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500 text-slate-950 font-black text-xs px-3 py-1.5 shrink-0 gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Auto-Credited
                    </Badge>
                  </div>
                </div>
              )}

              {/* Step Footer Navigation */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div className="flex items-center gap-1.5">
                  {WALKTHROUGH_STEPS.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setActiveStep(idx);
                        setAutoPlay(false);
                      }}
                      className={`h-2 rounded-full transition-all ${
                        activeStep === idx ? "w-7 bg-amber-400" : "w-2 bg-white/20"
                      }`}
                    />
                  ))}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveStep((prev) => (prev + 1) % WALKTHROUGH_STEPS.length)}
                  className="h-8 text-xs font-bold text-amber-300 hover:text-amber-200 gap-1"
                >
                  Next Step <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Right Stage: Interactive Animated Mini-Game Rules Preview (5 cols) */}
            <div className="lg:col-span-5 p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-amber-500/30 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                  🎬 Live Game Mechanics Preview
                </span>
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-white/10">
                  {(["oware", "ludo", "dame"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setActiveGameDemo(g)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                        activeGameDemo === g
                          ? "bg-amber-500 text-slate-950"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Animated Oware Mini-Demo */}
              {activeGameDemo === "oware" && (
                <div className="p-3.5 rounded-2xl bg-[#18191c] border-2 border-[#34363c] space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-orange-300">🪨 Oware Nam-Nam (4-Seed Relay)</span>
                    <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                      {demoTick < 4
                        ? `✋ Sowing Bowl #${(demoTick % 4) + 1}`
                        : "🔥 4 Seeds = +4 Harvest!"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-4 gap-2 py-1">
                    {[0, 1, 2, 3].map((idx) => {
                      const isActive = demoTick % 4 === idx;
                      const isFourHarvest = idx === 3 && demoTick >= 3;
                      const seedCount = isFourHarvest ? 4 : idx === 0 && demoTick > 0 ? 0 : 3 + (demoTick > idx ? 1 : 0);
                      return (
                        <div
                          key={idx}
                          className={`aspect-square rounded-full flex flex-col items-center justify-center relative border-2 transition-all ${
                            isFourHarvest
                              ? "border-amber-300 ring-4 ring-amber-400/50 scale-110"
                              : isActive
                              ? "border-emerald-400 scale-105"
                              : "border-[#2d1206]"
                          }`}
                          style={{
                            background:
                              "radial-gradient(circle at 36% 30%, #e06d34 0%, #c64f18 55%, #4a1502 100%)",
                          }}
                        >
                          <span className="text-xs font-black text-white font-mono">
                            {isFourHarvest ? "+4🔥" : seedCount}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    Tap a bowl to sow counter-clockwise. Landing on a non-empty bowl triggers a{" "}
                    <strong className="text-amber-300">Nam-Nam Relay Scoop</strong>; any bowl reaching{" "}
                    <strong className="text-emerald-300">4 seeds</strong> is harvested!
                  </p>
                </div>
              )}

              {/* Animated Ghana Ludo Mini-Demo */}
              {activeGameDemo === "ludo" && (
                <div className="p-3.5 rounded-2xl bg-slate-900 border border-indigo-500/30 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-indigo-300">🎲 Ghana Ludo (Kick Edition)</span>
                    <Badge className="bg-indigo-600 text-white font-black text-[10px]">
                      {demoTick % 2 === 0 ? "🎲 Rolled a 6! Bonus Roll!" : "💥 KICK Opponent to Yard!"}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between gap-2 py-2 px-2 rounded-xl bg-[#eef6fb] border border-slate-400">
                    {[0, 1, 2, 3, 4].map((step) => {
                      const tokenAt = demoTick % 5 === step;
                      return (
                        <div
                          key={step}
                          className={`w-10 h-10 rounded-lg border flex items-center justify-center relative ${
                            step === 0
                              ? "bg-[#dc2626] text-white"
                              : step === 4
                              ? "bg-[#eab308] text-slate-950"
                              : "bg-white text-slate-700"
                          }`}
                        >
                          {tokenAt ? (
                            <span className="w-6 h-6 rounded-full bg-red-600 border-2 border-white shadow flex items-center justify-center text-[10px] font-black text-white animate-bounce">
                              1
                            </span>
                          ) : step === 3 ? (
                            <span className="w-5 h-5 rounded-full bg-yellow-400 border border-slate-900 text-[9px] font-black text-slate-950 flex items-center justify-center">
                              2
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold opacity-60">
                              {step === 0 ? "★" : step === 4 ? "🏠" : step}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">
                    Tap the <strong className="text-indigo-300">3D Blue Dice</strong> in the center of the board. Roll <strong className="text-amber-300">6</strong> to exit your Yard, kick opponent tokens back to base, and race <strong className="text-emerald-300">2 tokens HOME</strong>!
                  </p>
                </div>
              )}

              {/* Animated Ghanaian Dame Mini-Demo */}
              {activeGameDemo === "dame" && (
                <div className="p-3.5 rounded-2xl bg-[#2b1408] border-2 border-[#6b3719] space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-black text-amber-300">♟️ Ghanaian Dame (Draughts)</span>
                    <Badge className="bg-amber-500 text-slate-950 font-black text-[10px]">
                      {demoTick % 2 === 0 ? "🔥 Mandatory Jump (Chop)!" : "👑 Crowned King!"}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-center gap-2 py-2">
                    {[0, 1, 2].map((sq) => {
                      const jumped = demoTick % 2 === 1;
                      return (
                        <div
                          key={sq}
                          className="w-11 h-11 rounded-lg bg-[#1d0c04] border border-amber-500/30 flex items-center justify-center"
                        >
                          {sq === 0 && !jumped && (
                            <span className="w-7 h-7 rounded-full bg-amber-400 border-2 border-white shadow" />
                          )}
                          {sq === 1 && !jumped && (
                            <span className="w-7 h-7 rounded-full bg-rose-600 border-2 border-rose-200 shadow" />
                          )}
                          {sq === 1 && jumped && (
                            <span className="text-[10px] font-black text-amber-400">CHOP!</span>
                          )}
                          {sq === 2 && jumped && (
                            <span className="w-8 h-8 rounded-full bg-amber-400 border-2 border-white shadow flex items-center justify-center text-slate-950 animate-bounce">
                              <Crown className="w-4 h-4 stroke-[2.5]" />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-200 leading-snug">
                    Move diagonally on dark squares. Jumping an exposed opponent piece is{" "}
                    <strong className="text-amber-300">mandatory</strong>. Reach the far row to crown a{" "}
                    <strong className="text-emerald-300">King (👑)</strong>!
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
