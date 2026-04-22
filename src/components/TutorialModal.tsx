import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  X, ChevronRight, ChevronLeft, Wifi, CreditCard, CheckCircle2,
  Store, TrendingUp, Users, Zap, Phone, ShieldCheck, Star,
  ArrowRight, Smartphone, CircleDollarSign, BadgeCheck, Gift,
} from "lucide-react";

const STORAGE_KEY = "swiftdata-tutorial-seen";

/* ── Shared animated illustration atoms ── */

const PulseRing = ({ color }: { color: string }) => (
  <span className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ background: color }} />
);

const PhoneFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="relative mx-auto w-28 h-48 rounded-2xl border-2 border-white/20 flex flex-col items-center justify-center overflow-hidden"
    style={{ background: "linear-gradient(180deg, #111124 0%, #0d0d18 100%)" }}>
    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-white/20" />
    {children}
  </div>
);

const NetworkBadge = ({ name, color, delay = 0 }: { name: string; color: string; delay?: number }) => (
  <div
    className="rounded-lg px-2 py-1 text-center font-black text-xs text-black transition-all"
    style={{ background: color, animation: `tutorial-bob 2s ease-in-out ${delay}ms infinite` }}
  >
    {name}
  </div>
);

const StepDot = ({ active, done }: { active: boolean; done: boolean }) => (
  <div className={`rounded-full transition-all duration-300 ${
    done ? "w-2 h-2 bg-green-400" : active ? "w-6 h-2 bg-amber-400" : "w-2 h-2 bg-white/20"
  }`} />
);

/* ── Path selection card ── */
const PathCard = ({
  icon: Icon,
  title,
  description,
  accent,
  onClick,
}: {
  icon: typeof Wifi;
  title: string;
  description: string;
  accent: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="group w-full rounded-2xl border border-white/8 p-4 text-left transition-all duration-200 hover:border-white/20 hover:scale-[1.02] active:scale-[0.99]"
    style={{ background: "rgba(255,255,255,0.03)" }}
  >
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all group-hover:scale-110"
        style={{ background: `${accent}20`, border: `1px solid ${accent}30` }}>
        <Icon className="w-5 h-5" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold text-sm">{title}</p>
        <p className="text-white/40 text-xs mt-0.5 leading-snug">{description}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-white/25 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all shrink-0" />
    </div>
  </button>
);

/* ── Step illustrations ── */

const BuyStep1 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="flex gap-2">
      {[
        { name: "MTN", color: "#f59e0b" },
        { name: "Telecel", color: "#dc2626" },
        { name: "AirtelTigo", color: "#2563eb" },
      ].map((n, i) => (
        <div key={n.name} className="relative">
          <div
            className="rounded-xl px-3 py-2.5 text-center font-black text-xs transition-all"
            style={{
              background: i === 0 ? n.color : `${n.color}25`,
              color: i === 0 ? (n.name === "MTN" ? "#000" : "#fff") : n.color,
              border: `2px solid ${i === 0 ? n.color : `${n.color}40`}`,
              animation: `tutorial-bob 2s ease-in-out ${i * 200}ms infinite`,
            }}
          >
            {n.name}
          </div>
          {i === 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 flex items-center justify-center">
              <CheckCircle2 className="w-2 h-2 text-black" />
            </span>
          )}
        </div>
      ))}
    </div>
    <p className="text-white/50 text-xs text-center">Tap your preferred network</p>
    <div className="grid grid-cols-3 gap-2 w-full max-w-[240px]">
      {["1GB", "5GB", "10GB", "20GB", "30GB", "50GB"].map((size, i) => (
        <div
          key={size}
          className="rounded-xl p-2 text-center"
          style={{
            background: i === 1 ? "#f59e0b" : "rgba(245,158,11,0.08)",
            border: `1px solid ${i === 1 ? "#f59e0b" : "rgba(245,158,11,0.15)"}`,
            animation: `tutorial-fade-in 0.4s ease-out ${i * 80}ms both`,
            transform: i === 1 ? "scale(1.05)" : "scale(1)",
          }}
        >
          <p className={`font-black text-sm ${i === 1 ? "text-black" : "text-amber-400"}`}>{size}</p>
        </div>
      ))}
    </div>
  </div>
);

const BuyStep2 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px]">
      <div className="rounded-xl border border-white/15 flex items-center px-3 py-2.5 gap-2" style={{ background: "rgba(255,255,255,0.07)" }}>
        <Phone className="w-4 h-4 text-white/40 shrink-0" />
        <div className="flex-1">
          <p className="text-white text-sm font-mono" style={{ animation: "tutorial-type 3s steps(11) infinite" }}>
            0241234567
          </p>
        </div>
        <div className="w-0.5 h-4 bg-amber-400" style={{ animation: "tutorial-cursor 1s step-end infinite" }} />
      </div>
      <p className="text-white/40 text-xs mt-2 text-center">Enter the recipient's number</p>
    </div>
    <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 w-full max-w-[280px]" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
      <Smartphone className="w-4 h-4 text-amber-400" />
      <p className="text-amber-300 text-xs">It can be your own number or someone else's</p>
    </div>
  </div>
);

const BuyStep3 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px] rounded-2xl overflow-hidden border border-white/10" style={{ background: "#0d0d18" }}>
      <div className="px-4 py-3 border-b border-white/8">
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40">MTN 5GB</span>
          <span className="text-white font-bold">GH₵ 22.85</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        <div className="flex justify-between text-xs text-white/50">
          <span>Bundle price</span><span>GH₵ 21.20</span>
        </div>
        <div className="flex justify-between text-xs text-white/50">
          <span>Paystack fee (3%)</span><span>GH₵ 0.64</span>
        </div>
        <div className="flex justify-between text-sm font-bold text-white border-t border-white/8 pt-2 mt-1">
          <span>Total</span><span className="text-amber-400">GH₵ 21.84</span>
        </div>
      </div>
      <div className="px-4 pb-4">
        <div
          className="w-full rounded-xl py-2.5 flex items-center justify-center gap-2 font-black text-sm text-black"
          style={{ background: "#f59e0b", animation: "tutorial-pulse-btn 2s ease-in-out infinite" }}
        >
          <CreditCard className="w-4 h-4" />
          Pay GH₵ 21.84
        </div>
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Pay with card or Mobile Money via Paystack</p>
  </div>
);

const BuyStep4 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)", border: "2px solid rgba(34,197,94,0.4)" }}>
        <CheckCircle2 className="w-10 h-10 text-green-400" style={{ animation: "tutorial-pop 0.5s ease-out both" }} />
      </div>
      <div className="absolute -inset-2 rounded-full border border-green-400/20" style={{ animation: "tutorial-ring 2s ease-out infinite" }} />
    </div>
    <div className="text-center">
      <p className="text-white font-bold text-base mb-1">Data delivered! 🎉</p>
      <p className="text-white/50 text-xs max-w-[220px] mx-auto">Your bundle is activated within seconds after payment</p>
    </div>
    <div className="flex gap-3">
      {[
        { icon: ShieldCheck, label: "Paystack secured", color: "#22c55e" },
        { icon: Zap, label: "Instant delivery", color: "#f59e0b" },
      ].map((b) => (
        <div key={b.label} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
          style={{ background: `${b.color}10`, border: `1px solid ${b.color}25`, color: b.color }}>
          <b.icon className="w-3 h-3" /> {b.label}
        </div>
      ))}
    </div>
  </div>
);

const AgentStep1 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
        <Users className="w-8 h-8 text-amber-400" />
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2 w-full max-w-[260px]">
      {[
        { icon: Store, label: "Own store link", color: "#f59e0b" },
        { icon: CircleDollarSign, label: "Set your prices", color: "#22c55e" },
        { icon: TrendingUp, label: "Earn profit", color: "#3b82f6" },
      ].map((b) => (
        <div key={b.label} className="rounded-xl p-2.5 text-center border border-white/8" style={{ background: "rgba(255,255,255,0.03)" }}>
          <b.icon className="w-5 h-5 mx-auto mb-1" style={{ color: b.color }} />
          <p className="text-white/60 text-[10px] leading-tight">{b.label}</p>
        </div>
      ))}
    </div>
    <p className="text-white/50 text-xs text-center max-w-[220px]">
      Agents get wholesale prices and their own Paystack-powered storefront
    </p>
  </div>
);

const AgentStep2 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="w-full max-w-[280px] rounded-2xl border border-white/10 overflow-hidden" style={{ background: "#111124" }}>
      <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <div className="w-2 h-2 rounded-full bg-amber-400" />
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-white/30 text-[10px] ml-1">swiftdatagh.com/login</span>
      </div>
      <div className="p-4 space-y-2">
        <div className="h-7 rounded-lg border border-white/10" style={{ background: "rgba(255,255,255,0.05)", animation: "tutorial-fade-in 0.5s ease-out 0.2s both" }}>
          <div className="px-3 flex items-center h-full">
            <span className="text-white/30 text-xs">Email address</span>
          </div>
        </div>
        <div className="h-7 rounded-lg border border-white/10" style={{ background: "rgba(255,255,255,0.05)", animation: "tutorial-fade-in 0.5s ease-out 0.4s both" }}>
          <div className="px-3 flex items-center h-full">
            <span className="text-white/30 text-xs">Password</span>
          </div>
        </div>
        <div className="h-8 rounded-lg flex items-center justify-center font-bold text-sm text-black" style={{ background: "#f59e0b", animation: "tutorial-fade-in 0.5s ease-out 0.6s both" }}>
          Create Account
        </div>
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Sign up free — takes 30 seconds</p>
  </div>
);

const AgentStep3 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px]">
      <div className="rounded-2xl border border-amber-400/30 p-4" style={{ background: "rgba(245,158,11,0.06)" }}>
        <div className="flex items-center gap-2 mb-3">
          <BadgeCheck className="w-5 h-5 text-amber-400" />
          <span className="text-amber-300 font-bold text-sm">Agent Program</span>
        </div>
        <div className="space-y-1.5 mb-3">
          {["Wholesale bundle prices", "Your own branded store", "Sub-agent network", "Instant payouts"].map((f, i) => (
            <div key={f} className="flex items-center gap-2 text-xs text-white/60" style={{ animation: `tutorial-fade-in 0.4s ease-out ${i * 100}ms both` }}>
              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" /> {f}
            </div>
          ))}
        </div>
        <div className="rounded-xl py-2 flex items-center justify-center gap-1.5 text-sm font-bold text-black" style={{ background: "#f59e0b" }}>
          <Gift className="w-3.5 h-3.5" /> Apply for Agent Program
        </div>
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Apply from your dashboard after signing up</p>
  </div>
);

const AgentStep4 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px]">
      <div className="rounded-2xl border border-white/10 p-4" style={{ background: "#111124" }}>
        <div className="flex items-center gap-2 mb-3">
          <Store className="w-4 h-4 text-amber-400" />
          <span className="text-white font-bold text-sm">Your Store is Live 🎉</span>
        </div>
        <div className="rounded-lg border border-amber-400/20 px-3 py-2 flex items-center gap-2" style={{ background: "rgba(245,158,11,0.08)" }}>
          <span className="text-amber-400 text-xs font-mono truncate">swiftdatagh.com/store/</span>
          <span className="text-amber-300 font-bold text-xs">yourname</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg p-2 text-center border border-green-500/20" style={{ background: "rgba(34,197,94,0.08)" }}>
            <p className="text-green-400 font-black text-lg">GH₵0</p>
            <p className="text-white/40 text-[10px]">Today's profit</p>
          </div>
          <div className="rounded-lg p-2 text-center border border-blue-500/20" style={{ background: "rgba(59,130,246,0.08)" }}>
            <p className="text-blue-400 font-black text-lg">0</p>
            <p className="text-white/40 text-[10px]">Customers</p>
          </div>
        </div>
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Share your link and start earning immediately</p>
  </div>
);

const SubStep1 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px] rounded-2xl border border-white/10 overflow-hidden" style={{ background: "#0d0d18" }}>
      <div className="p-4 text-center border-b border-white/8">
        <p className="text-white font-bold text-sm">Agent's Store</p>
        <p className="text-white/40 text-xs">swiftdatagh.com/store/<span className="text-amber-400">agentname</span></p>
      </div>
      <div className="p-4">
        <div className="rounded-xl border border-amber-400/30 p-3" style={{ background: "rgba(245,158,11,0.06)" }}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-amber-300 font-bold text-xs">Become a Sub Agent</span>
          </div>
          <p className="text-white/40 text-[10px] mb-2">Get your own store & earn income</p>
          <div className="rounded-lg py-1.5 text-center text-xs font-bold text-black" style={{ background: "#f59e0b", animation: "tutorial-pulse-btn 2s ease-in-out infinite" }}>
            Join Now →
          </div>
        </div>
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Find the "Become a Sub Agent" section on any agent's store</p>
  </div>
);

const SubStep2 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="w-full max-w-[280px] rounded-2xl border border-white/10 p-4 space-y-2" style={{ background: "#111124" }}>
      {["Full name", "Phone number", "Email address"].map((label, i) => (
        <div key={label} className="h-8 rounded-lg border border-white/10 flex items-center px-3" style={{ background: "rgba(255,255,255,0.05)", animation: `tutorial-fade-in 0.4s ease-out ${i * 150}ms both` }}>
          <span className="text-white/30 text-xs">{label}</span>
        </div>
      ))}
      <div className="h-8 rounded-lg flex items-center justify-center text-xs font-bold text-black" style={{ background: "#f59e0b", animation: "tutorial-fade-in 0.4s ease-out 0.5s both" }}>
        Submit Application
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">Fill in your details on the signup form</p>
  </div>
);

const SubStep3 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative w-full max-w-[280px] rounded-2xl border border-white/10 p-4" style={{ background: "#111124" }}>
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="w-4 h-4 text-amber-400" />
        <span className="text-white font-bold text-sm">Pay Activation Fee</span>
      </div>
      <div className="rounded-xl p-3 border border-white/8 mb-3" style={{ background: "rgba(255,255,255,0.03)" }}>
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-white/50">Sub-agent activation</span>
          <span className="text-white font-bold">GH₵ 50.00</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-white/50">One-time fee</span>
          <span className="text-green-400 text-[10px] font-semibold">✓ Lifetime access</span>
        </div>
      </div>
      <div className="rounded-xl py-2.5 flex items-center justify-center gap-2 text-sm font-bold text-black" style={{ background: "#f59e0b", animation: "tutorial-pulse-btn 2s ease-in-out infinite" }}>
        <ShieldCheck className="w-4 h-4" /> Pay via Paystack
      </div>
    </div>
    <p className="text-white/40 text-xs text-center">One-time activation fee — set by your parent agent</p>
  </div>
);

const SubStep4 = () => (
  <div className="flex flex-col items-center gap-4 py-4">
    <div className="relative">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "rgba(245,158,11,0.15)", border: "2px solid rgba(245,158,11,0.4)" }}>
        <Star className="w-10 h-10 text-amber-400" style={{ animation: "tutorial-pop 0.5s ease-out both" }} />
      </div>
      <div className="absolute -inset-2 rounded-full border border-amber-400/20" style={{ animation: "tutorial-ring 2s ease-out infinite" }} />
    </div>
    <div className="text-center">
      <p className="text-white font-bold text-base mb-1">You're an active Sub Agent! 🚀</p>
      <p className="text-white/50 text-xs max-w-[220px] mx-auto mb-4">Your own store is ready. Share your link and start earning.</p>
    </div>
    <div className="grid grid-cols-2 gap-2 w-full max-w-[260px]">
      {[
        { label: "Your store link", value: "Unique URL", color: "#f59e0b" },
        { label: "Earn profit on", value: "Every sale", color: "#22c55e" },
        { label: "Dashboard access", value: "Full control", color: "#3b82f6" },
        { label: "Set your prices", value: "Any margin", color: "#a855f7" },
      ].map((b) => (
        <div key={b.label} className="rounded-xl p-2.5 border border-white/8 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
          <p className="text-[10px] text-white/40">{b.label}</p>
          <p className="text-xs font-bold mt-0.5" style={{ color: b.color }}>{b.value}</p>
        </div>
      ))}
    </div>
  </div>
);

/* ── Flow definitions ── */
type Flow = "buy" | "agent" | "subagent";

const FLOWS: Record<Flow, {
  title: string;
  accent: string;
  cta: { label: string; to: string };
  steps: { title: string; subtitle: string; component: React.FC }[];
}> = {
  buy: {
    title: "How to Buy Data",
    accent: "#f59e0b",
    cta: { label: "Buy Data Now", to: "/buy-data" },
    steps: [
      { title: "Pick your network & bundle", subtitle: "Select MTN, Telecel, or AirtelTigo then tap a data bundle", component: BuyStep1 },
      { title: "Enter recipient number", subtitle: "Type in the Ghana phone number that will receive the data", component: BuyStep2 },
      { title: "Pay securely", subtitle: "Tap Pay and complete with card or MoMo on Paystack", component: BuyStep3 },
      { title: "Delivered instantly!", subtitle: "Your data bundle lands within seconds — no delays", component: BuyStep4 },
    ],
  },
  agent: {
    title: "Become an Agent",
    accent: "#22c55e",
    cta: { label: "Apply for Agent Program", to: "/agent-program" },
    steps: [
      { title: "Why become an agent?", subtitle: "Get wholesale prices, your own store, and build passive income", component: AgentStep1 },
      { title: "Create a free account", subtitle: "Sign up in 30 seconds — no credit card required", component: AgentStep2 },
      { title: "Apply for the program", subtitle: "Find 'Agent Program' in your dashboard and submit your application", component: AgentStep3 },
      { title: "Your store goes live!", subtitle: "Share your unique link and start earning on every sale", component: AgentStep4 },
    ],
  },
  subagent: {
    title: "Become a Sub Agent",
    accent: "#a855f7",
    cta: { label: "Find an Agent Store", to: "/buy-data" },
    steps: [
      { title: "Visit any agent store", subtitle: "Find a SwiftData agent and open their store link", component: SubStep1 },
      { title: "Fill your details", subtitle: "Click 'Become a Sub Agent' and complete the signup form", component: SubStep2 },
      { title: "Pay the activation fee", subtitle: "One-time fee set by your parent agent — paid via Paystack", component: SubStep3 },
      { title: "Start selling!", subtitle: "Your own store is ready — share your link and earn on every order", component: SubStep4 },
    ],
  },
};

/* ── Main modal ── */
export default function TutorialModal() {
  const [visible, setVisible] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [step, setStep] = useState(0);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  const goStep = (dir: "forward" | "back") => {
    setAnimDir(dir);
    setStep((s) => s + (dir === "forward" ? 1 : -1));
  };

  if (!visible) {
    return (
      <button
        onClick={() => { setFlow(null); setStep(0); setVisible(true); }}
        className="fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/30 transition-all hover:scale-110 shadow-lg"
        style={{ background: "rgba(13,13,24,0.9)", backdropFilter: "blur(12px)" }}
        title="How it works"
      >
        <span className="text-base font-black">?</span>
      </button>
    );
  }

  const currentFlow = flow ? FLOWS[flow] : null;
  const currentStep = currentFlow?.steps[step];
  const StepComponent = currentStep?.component;
  const totalSteps = currentFlow?.steps.length ?? 0;
  const isLastStep = step === totalSteps - 1;

  return (
    <>
      {/* CSS animations injected once */}
      <style>{`
        @keyframes tutorial-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes tutorial-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes tutorial-pop {
          0%   { transform: scale(0); opacity: 0; }
          70%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes tutorial-ring {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes tutorial-slide-in-right {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
        @keyframes tutorial-slide-in-left {
          from { transform: translateX(-40px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes tutorial-slide-up {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes tutorial-pulse-btn {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
          50%       { box-shadow: 0 0 0 8px rgba(245,158,11,0.15); }
        }
        @keyframes tutorial-cursor {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes tutorial-type {
          from { width: 0; }
          to   { width: 100%; }
        }
        .tutorial-enter-right { animation: tutorial-slide-in-right 0.3s ease-out both; }
        .tutorial-enter-left  { animation: tutorial-slide-in-left  0.3s ease-out both; }
        .tutorial-enter-up    { animation: tutorial-slide-up        0.35s ease-out both; }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      >
        <div
          className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl overflow-hidden tutorial-enter-up"
          style={{ background: "linear-gradient(180deg, #111124 0%, #0d0d18 100%)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              {flow && (
                <button onClick={() => { setFlow(null); setStep(0); }} className="text-white/40 hover:text-white/70 transition-colors p-1 -ml-1">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div>
                <h2 className="text-white font-black text-base leading-tight">
                  {flow ? currentFlow!.title : "Welcome to SwiftData 👋"}
                </h2>
                {!flow && <p className="text-white/40 text-xs mt-0.5">What would you like to do?</p>}
              </div>
            </div>
            <button onClick={dismiss} className="text-white/30 hover:text-white/60 transition-colors p-1.5 rounded-lg hover:bg-white/8">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Path selection */}
          {!flow && (
            <div className="px-5 pb-5 space-y-2.5 tutorial-enter-up">
              <PathCard
                icon={Wifi} accent="#f59e0b"
                title="Buy a data bundle"
                description="Purchase MTN, Telecel or AirtelTigo data — no account needed"
                onClick={() => { setFlow("buy"); setStep(0); }}
              />
              <PathCard
                icon={TrendingUp} accent="#22c55e"
                title="Become a data agent"
                description="Get wholesale prices, your own store and earn on every sale"
                onClick={() => { setFlow("agent"); setStep(0); }}
              />
              <PathCard
                icon={Users} accent="#a855f7"
                title="Become a sub-agent"
                description="Join under an existing agent and start your own reselling business"
                onClick={() => { setFlow("subagent"); setStep(0); }}
              />
              <div className="pt-2 border-t border-white/8 flex items-center justify-between">
                <p className="text-white/25 text-xs">SwiftData Ghana — #1 Data Bundles</p>
                <button onClick={dismiss} className="text-white/30 hover:text-white/50 text-xs transition-colors">Skip tutorial</button>
              </div>
            </div>
          )}

          {/* Step content */}
          {flow && currentStep && StepComponent && (
            <div className="px-5 pb-5">
              {/* Step progress dots */}
              <div className="flex items-center gap-1.5 mb-3">
                {currentFlow!.steps.map((_, i) => (
                  <StepDot key={i} active={i === step} done={i < step} />
                ))}
                <span className="text-white/25 text-xs ml-auto">{step + 1} / {totalSteps}</span>
              </div>

              {/* Step header */}
              <div className={animDir === "forward" ? "tutorial-enter-right" : "tutorial-enter-left"} key={`header-${step}`}>
                <h3 className="text-white font-bold text-sm mb-0.5">{currentStep.title}</h3>
                <p className="text-white/45 text-xs leading-snug">{currentStep.subtitle}</p>
              </div>

              {/* Illustration */}
              <div
                key={`step-${step}`}
                className={`min-h-[220px] flex items-center justify-center ${animDir === "forward" ? "tutorial-enter-right" : "tutorial-enter-left"}`}
              >
                <div className="w-full">
                  <StepComponent />
                </div>
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-2 mt-1">
                {step > 0 && (
                  <button
                    onClick={() => goStep("back")}
                    className="px-3 py-2.5 rounded-xl border border-white/12 text-white/50 hover:text-white/80 hover:border-white/25 transition-all text-sm font-medium"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}

                {isLastStep ? (
                  <Link
                    to={currentFlow!.cta.to}
                    onClick={dismiss}
                    className="flex-1 py-2.5 rounded-xl font-black text-sm text-center flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: currentFlow!.accent, color: flow === "buy" ? "#000" : "#fff" }}
                  >
                    {currentFlow!.cta.label} <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <button
                    onClick={() => goStep("forward")}
                    className="flex-1 py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: currentFlow!.accent, color: flow === "buy" ? "#000" : "#fff" }}
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
