import {
  ArrowRight, ShieldCheck, Zap, Store, TrendingUp, CheckCircle2,
  ChevronDown, Clock, Wifi, Users, BarChart3,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import StoreVisitorPopup from "@/components/StoreVisitorPopup";

// ─── Data ─────────────────────────────────────────────────────────────────────
const NETWORK_CARDS = [
  {
    name: "MTN",
    accent: "bg-amber-400",
    iconText: "text-black",
    samples: [
      { size: "1 GB", price: "GH₵ 4.98" },
      { size: "5 GB", price: "GH₵ 21.20" },
      { size: "10 GB", price: "GH₵ 42.50" },
      { size: "50 GB", price: "GH₵ 199.30" },
    ],
    glow: "group-hover:shadow-amber-400/10 dark:group-hover:shadow-amber-400/10",
    top: "bg-amber-400",
  },
  {
    name: "Telecel",
    accent: "bg-red-600",
    iconText: "text-white",
    samples: [
      { size: "5 GB", price: "GH₵ 23.00" },
      { size: "10 GB", price: "GH₵ 41.80" },
      { size: "15 GB", price: "GH₵ 58.99" },
      { size: "30 GB", price: "GH₵ 125.50" },
    ],
    glow: "group-hover:shadow-red-500/10",
    top: "bg-red-600",
  },
  {
    name: "AirtelTigo",
    accent: "bg-blue-600",
    iconText: "text-white",
    samples: [
      { size: "1 GB", price: "GH₵ 4.30" },
      { size: "5 GB", price: "GH₵ 19.85" },
      { size: "8 GB", price: "GH₵ 30.59" },
      { size: "9 GB", price: "GH₵ 34.20" },
    ],
    glow: "group-hover:shadow-blue-500/10",
    top: "bg-blue-600",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Choose a Bundle",
    desc: "Select your network (MTN, Telecel or AirtelTigo) and pick a data bundle size that fits your needs.",
    color: "text-amber-500",
    border: "border-amber-400/25",
    bg: "bg-amber-400/8",
  },
  {
    step: "02",
    title: "Enter & Pay",
    desc: "Type in the recipient's phone number and pay securely with card or Mobile Money via Paystack.",
    color: "text-emerald-500",
    border: "border-emerald-400/25",
    bg: "bg-emerald-400/8",
  },
  {
    step: "03",
    title: "Receive Instantly",
    desc: "Data lands on the recipient's line in under 5 seconds. No app, no account, no delays.",
    color: "text-sky-500",
    border: "border-sky-400/25",
    bg: "bg-sky-400/8",
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: "No Account Needed",
    desc: "Pick a bundle and pay directly with card or MoMo. No sign-up, no waiting.",
    color: "text-amber-500",
    bg: "bg-amber-400/8 dark:bg-amber-400/8",
    border: "border-amber-400/20",
  },
  {
    icon: ShieldCheck,
    title: "Instant & Secure Delivery",
    desc: "Data lands in seconds after payment. Every transaction is secured by Paystack.",
    color: "text-emerald-500",
    bg: "bg-emerald-400/8 dark:bg-emerald-400/8",
    border: "border-emerald-400/20",
  },
  {
    icon: TrendingUp,
    title: "Non-Expiry Bundles",
    desc: "All data bundles are non-expiry — use them at your own pace, anytime.",
    color: "text-sky-500",
    bg: "bg-sky-400/8 dark:bg-sky-400/8",
    border: "border-sky-400/20",
  },
  {
    icon: Store,
    title: "Agent & Reseller Program",
    desc: "Unlock wholesale rates and launch your own Paystack-powered data store.",
    color: "text-purple-500",
    bg: "bg-purple-400/8 dark:bg-purple-400/8",
    border: "border-purple-400/20",
  },
];

const TRUST_STATS = [
  { value: "3 Networks", label: "MTN, Telecel & AirtelTigo" },
  { value: "< 5 sec", label: "Average delivery time" },
  { value: "24 / 7", label: "Always available" },
  { value: "100%", label: "Paystack secured" },
];

const FAQS = [
  {
    q: "Where can I buy the cheapest MTN data bundles in Ghana?",
    a: "SwiftData Ghana (swiftdatagh.com) offers some of the cheapest non-expiry MTN data bundles in Ghana — no account required. Select a bundle, enter the recipient number and pay with card or MoMo via Paystack.",
  },
  {
    q: "Are SwiftData Ghana bundles non-expiry?",
    a: "Yes. Every bundle sold on SwiftData Ghana is non-expiry. They don't expire and you can use them at any pace.",
  },
  {
    q: "Which networks does SwiftData Ghana support?",
    a: "SwiftData Ghana supports MTN Ghana, Telecel Ghana (formerly Vodafone), and AirtelTigo Ghana — all with a wide range of bundle sizes.",
  },
  {
    q: "How fast is data delivery on SwiftData Ghana?",
    a: "Most orders are delivered in under 5 seconds after Paystack confirms payment. Available 24 hours a day, 7 days a week.",
  },
  {
    q: "Can I pay for data bundles with Mobile Money (MoMo) in Ghana?",
    a: "Yes, absolutely! We accept all major Mobile Money networks in Ghana including MTN MoMo, Telecel Cash, and ATMoney through our secure Paystack checkout.",
  },
  {
    q: "Is it safe to buy data bundles online in Ghana with SwiftData?",
    a: "100% safe. All payments are processed through Paystack, Ghana's most trusted and secure payment gateway. We don't store any of your card or payment details.",
  },
  {
    q: "Can I resell data bundles and earn money with SwiftData Ghana?",
    a: "Yes! Our agent programme lets you activate a reseller account, unlock wholesale prices, and get your own online store where customers can buy directly from you via Paystack.",
  },
];

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────
const useReveal = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
};

// ─── FAQ Accordion ────────────────────────────────────────────────────────────
const FaqItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 dark:border-white/6 last:border-0">
      <button
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left group"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="font-semibold text-sm text-gray-700 dark:text-white/80 group-hover:text-gray-900 dark:group-hover:text-white transition-colors leading-relaxed">
          {q}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-gray-300 dark:text-white/30 transition-transform duration-200 ${open ? "rotate-180 !text-amber-500" : ""}`}
        />
      </button>
      {open && (
        <p className="px-6 pb-5 text-sm text-gray-500 dark:text-white/40 leading-relaxed">{a}</p>
      )}
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────
const Index = () => {
  const networks = useReveal();
  const steps    = useReveal();
  const features = useReveal();
  const tracker  = useReveal();
  const agent    = useReveal();
  const faq      = useReveal();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#030305] text-gray-900 dark:text-white">

      {/* First-visit agent popup — shown once per session, admin-toggleable */}
      <StoreVisitorPopup agentSlug="home" showSubAgentLink={false} />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-36 pb-28 px-4">
        {/* Background glow mesh — visible in dark mode, subtle in light */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[700px] bg-amber-400/5 dark:bg-amber-400/7 rounded-full blur-[140px]" />
          <div className="absolute top-24 left-1/4 w-[500px] h-[400px] bg-blue-600/3 dark:bg-blue-600/5 rounded-full blur-[100px]" />
          <div className="absolute top-32 right-1/4 w-[400px] h-[350px] bg-red-600/3 dark:bg-red-600/4 rounded-full blur-[90px]" />
          <div className="absolute inset-0 opacity-[0.015]"
            style={{
              backgroundImage: "linear-gradient(rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.4) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div className="relative container mx-auto max-w-5xl text-center">
          {/* Status badge */}
          <div
            className="inline-flex items-center gap-2.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-full px-4 py-2 mb-10 shadow-sm"
            style={{ animation: "fade-in 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">Live</span>
            </span>
            <span className="w-px h-3 bg-gray-200 dark:bg-white/15" />
            <img src="/logo.png" alt="SwiftData Ghana" className="w-4 h-4 rounded-full" />
            <span className="text-gray-500 dark:text-white/50 text-xs font-medium">Ghana's #1 Data Bundle Store</span>
          </div>

          {/* Headline */}
          <h1
            className="text-5xl sm:text-6xl md:text-7xl font-black leading-[1.04] tracking-tight mb-6"
            style={{ animation: "fade-in 0.6s cubic-bezier(0.22,1,0.36,1) 0.1s both" }}
          >
            Cheapest Non-Expiry
            <br />
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
              Data Bundles Ghana
            </span>
          </h1>

          <p
            className="text-gray-500 dark:text-white/45 text-base md:text-lg max-w-2xl mx-auto leading-relaxed mb-10"
            style={{ animation: "fade-in 0.6s cubic-bezier(0.22,1,0.36,1) 0.2s both" }}
          >
            Buy <strong className="text-gray-700 dark:text-white/75 font-bold">MTN</strong>,{" "}
            <strong className="text-gray-700 dark:text-white/75 font-bold">Telecel</strong> and{" "}
            <strong className="text-gray-700 dark:text-white/75 font-bold">AirtelTigo</strong> data online.
            Instant delivery in under 5 seconds — secured by Paystack. No account needed.
          </p>

          {/* CTA buttons */}
          <div
            className="flex flex-col sm:flex-row gap-3 justify-center mb-12"
            style={{ animation: "fade-in 0.6s cubic-bezier(0.22,1,0.36,1) 0.3s both" }}
          >
            <Link
              to="/buy-data"
              className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black text-base px-10 py-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/20"
            >
              Buy Data Now <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              to="/agent-program"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white font-semibold text-base px-8 py-4 transition-all duration-200"
            >
              Start Selling Data
            </Link>
          </div>

          {/* Trust pills */}
          <div
            className="flex flex-wrap items-center justify-center gap-2"
            style={{ animation: "fade-in 0.6s cubic-bezier(0.22,1,0.36,1) 0.4s both" }}
          >
            {[
              { icon: ShieldCheck, text: "Paystack secured", color: "text-emerald-500" },
              { icon: Zap,         text: "Delivery under 5 s", color: "text-amber-500" },
              { icon: CheckCircle2,text: "Non-expiry bundles", color: "text-sky-500" },
              { icon: Clock,       text: "Available 24/7",     color: "text-purple-500" },
            ].map(({ icon: Icon, text, color }) => (
              <span
                key={text}
                className="inline-flex items-center gap-1.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/8 rounded-full px-3.5 py-2 text-xs text-gray-500 dark:text-white/45 shadow-sm"
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} /> {text}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats strip ────────────────────────────────────────────────────── */}
      <div className="border-y border-gray-200 dark:border-white/6 bg-white dark:bg-white/[0.018]">
        <div className="container mx-auto max-w-5xl px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {TRUST_STATS.map((s) => (
              <div key={s.label}>
                <p className="font-black text-2xl md:text-3xl text-amber-500">{s.value}</p>
                <p className="text-gray-400 dark:text-white/30 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Network cards ──────────────────────────────────────────────────── */}
      <section className="py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <p className="text-amber-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">All networks covered</p>
            <h2 className="text-3xl md:text-4xl font-black mb-3">Pick Your Network</h2>
            <p className="text-gray-500 dark:text-white/35 text-sm max-w-md mx-auto">
              Non-expiry bundles for every major network. Instant delivery, best prices in Ghana.
            </p>
          </div>

          <div
            ref={networks.ref}
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
            style={{
              opacity: networks.visible ? 1 : 0,
              transform: networks.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {NETWORK_CARDS.map((net, i) => (
              <div
                key={net.name}
                className={`group relative rounded-2xl border border-gray-200 dark:border-white/8 bg-white dark:bg-white/[0.025] overflow-hidden transition-all duration-300 hover:border-gray-300 dark:hover:border-white/14 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:shadow-2xl ${net.glow} shadow-sm`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                {/* Colored top accent bar */}
                <div className={`h-[3px] ${net.top}`} />

                <div className="p-6">
                  {/* Network identity */}
                  <div className="flex items-center gap-3 mb-6">
                    <div className={`w-10 h-10 rounded-xl ${net.accent} flex items-center justify-center shrink-0`}>
                      <Wifi className={`w-5 h-5 ${net.iconText}`} />
                    </div>
                    <div>
                      <p className="font-black text-lg leading-tight">{net.name} Ghana</p>
                      <p className="text-gray-400 dark:text-white/30 text-[11px]">Non-expiry · Instant</p>
                    </div>
                  </div>

                  {/* Price list */}
                  <div className="space-y-0 mb-6 rounded-xl border border-gray-100 dark:border-white/6 overflow-hidden">
                    {net.samples.map(({ size, price }, j) => (
                      <div
                        key={size}
                        className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                          j % 2 === 0 ? "bg-gray-50 dark:bg-white/[0.02]" : ""
                        } border-b border-gray-100 dark:border-white/5 last:border-0`}
                      >
                        <span className="font-semibold text-gray-700 dark:text-white/70">{size}</span>
                        <span className="font-black text-amber-500">{price}</span>
                      </div>
                    ))}
                    <div className="px-4 py-2 text-[10px] text-gray-400 dark:text-white/20">+ many more packages available</div>
                  </div>

                  <Link
                    to="/buy-data"
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-100 dark:bg-white/6 hover:bg-amber-400 text-gray-600 dark:text-white/60 hover:text-black font-bold text-sm py-3 transition-all duration-200"
                  >
                    Buy {net.name} Data <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link
              to="/buy-data"
              className="inline-flex items-center gap-2 text-sm text-gray-400 dark:text-white/40 hover:text-amber-500 transition-colors font-medium"
            >
              View all packages and prices <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section className="py-24 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-14">
            <p className="text-amber-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">Simple process</p>
            <h2 className="text-3xl md:text-4xl font-black mb-3">Buy Data in 3 Steps</h2>
            <p className="text-gray-500 dark:text-white/35 text-sm">No account, no waiting. Just pick, pay, and receive.</p>
          </div>

          <div
            ref={steps.ref}
            className="grid grid-cols-1 md:grid-cols-3 gap-5 relative"
            style={{
              opacity: steps.visible ? 1 : 0,
              transform: steps.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {/* Connector line (desktop only) */}
            <div className="hidden md:block absolute top-10 left-[calc(16.67%+1.25rem)] right-[calc(16.67%+1.25rem)] h-px border-t border-dashed border-gray-200 dark:border-white/10" />

            {STEPS.map(({ step, title, desc, color, border, bg }) => (
              <div key={step} className="relative rounded-2xl border border-gray-200 dark:border-white/8 bg-white dark:bg-white/[0.025] p-7 text-center shadow-sm">
                <div className={`w-14 h-14 rounded-2xl border ${border} ${bg} flex items-center justify-center mx-auto mb-5`}>
                  <span className={`text-xl font-black ${color}`}>{step}</span>
                </div>
                <h3 className="font-black text-base mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-white/35 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14">
            <p className="text-amber-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">Why SwiftData Ghana</p>
            <h2 className="text-3xl md:text-4xl font-black mb-3">Ghana's #1 Data Bundle Store</h2>
            <p className="text-gray-500 dark:text-white/35 text-sm max-w-xl mx-auto">
              Fast, secure, and built for Ghana. Everything you need from a modern data vending service.
            </p>
          </div>

          <div
            ref={features.ref}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            style={{
              opacity: features.visible ? 1 : 0,
              transform: features.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {FEATURES.map(({ icon: Icon, title, desc, color, bg, border }) => (
              <div
                key={title}
                className={`flex gap-5 rounded-2xl border ${border} ${bg} p-6 transition-all duration-200 hover:scale-[1.01] shadow-sm`}
              >
                <div className={`w-11 h-11 rounded-xl border ${border} ${bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <h3 className="font-black text-sm mb-1.5 text-gray-800 dark:text-white/90">{title}</h3>
                  <p className="text-sm text-gray-500 dark:text-white/38 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Order tracker ──────────────────────────────────────────────────── */}
      <section className="py-24 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-10">
            <p className="text-amber-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">Real-time tracking</p>
            <h2 className="text-3xl font-black mb-3">Track Your Order</h2>
            <p className="text-gray-500 dark:text-white/35 text-sm">
              Enter the recipient phone number to check delivery status instantly.
            </p>
          </div>
          <div
            ref={tracker.ref}
            style={{
              opacity: tracker.visible ? 1 : 0,
              transform: tracker.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <PhoneOrderTracker
              title="Track Your Data Delivery"
              subtitle="Enter the recipient phone number to check payment and delivery status instantly."
            />
          </div>
        </div>
      </section>

      {/* ── Agent CTA ──────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-5xl">
          <div
            ref={agent.ref}
            className="relative rounded-3xl overflow-hidden border border-amber-400/25 p-10 md:p-14 bg-white dark:bg-transparent shadow-sm"
            style={{
              opacity: agent.visible ? 1 : 0,
              transform: agent.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {/* Background gradients */}
            <div className="absolute inset-0 bg-gradient-to-br from-amber-400/5 via-transparent to-transparent pointer-events-none" />
            <div className="absolute -top-24 -right-24 w-[500px] h-[400px] bg-amber-400/4 dark:bg-amber-400/5 rounded-full blur-[120px] pointer-events-none" />

            <div className="relative flex flex-col md:flex-row md:items-center gap-10">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-full px-3.5 py-1.5 mb-5">
                  <Store className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400 text-[11px] font-bold uppercase tracking-widest">Agent & Reseller Program</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-black mb-4 leading-tight">
                  Start Your Data<br />Reselling Business
                </h2>
                <p className="text-gray-500 dark:text-white/40 text-sm max-w-md leading-relaxed mb-6">
                  Activate agent access to unlock wholesale MTN, Telecel &amp; AirtelTigo prices, profit tracking,
                  and your own Paystack-powered public store — all in one platform.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { icon: BarChart3, text: "Profit tracking" },
                    { icon: Store,     text: "Your own store" },
                    { icon: Zap,       text: "Wholesale prices" },
                    { icon: Users,     text: "Sub-agents" },
                  ].map(({ icon: Icon, text }) => (
                    <span
                      key={text}
                      className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/45 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/8 rounded-full px-3 py-1.5"
                    >
                      <Icon className="w-3 h-3 text-emerald-500" /> {text}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 shrink-0 min-w-[200px]">
                <Link
                  to="/agent-program"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black text-sm px-8 py-4 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-amber-400/20 whitespace-nowrap"
                >
                  Become a Data Agent <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-white/55 hover:text-gray-900 dark:hover:text-white font-semibold text-sm px-8 py-4 transition-all whitespace-nowrap"
                >
                  Sign In to Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <p className="text-amber-500 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">FAQ</p>
            <h2 className="text-3xl font-black mb-3">Frequently Asked Questions</h2>
            <p className="text-gray-500 dark:text-white/35 text-sm">
              Everything you need to know about buying data bundles in Ghana.
            </p>
          </div>
          <div
            ref={faq.ref}
            className="rounded-2xl border border-gray-200 dark:border-white/8 bg-white dark:bg-white/[0.02] overflow-hidden divide-y divide-gray-100 dark:divide-white/6 shadow-sm"
            style={{
              opacity: faq.visible ? 1 : 0,
              transform: faq.visible ? "translateY(0)" : "translateY(24px)",
              transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {FAQS.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── SEO footer text ────────────────────────────────────────────────── */}
      <section className="py-14 px-4 border-t border-gray-200 dark:border-white/6">
        <div className="container mx-auto max-w-3xl text-center">
          <div className="w-14 h-14 rounded-2xl border border-amber-400/20 bg-amber-400/8 flex items-center justify-center mx-auto mb-5">
            <img src="/logo.png" alt="SwiftData Ghana" className="w-9 h-9 rounded-full" />
          </div>
          <p className="font-black text-lg mb-2">SwiftData Ghana</p>
          <p className="text-gray-400 dark:text-white/25 text-xs max-w-2xl mx-auto leading-relaxed">
            Ghana's #1 cheapest data bundle store — buy non-expiry MTN data bundles, Telecel data bundles
            and AirtelTigo data bundles online. Instant delivery secured by Paystack.
            Serving all regions of Ghana 24/7.
          </p>
          <p className="text-gray-300 dark:text-white/12 text-[10px] mt-5">
            © {new Date().getFullYear()} SwiftData Ghana · swiftdatagh.com · All rights reserved.
          </p>
        </div>
      </section>

    </div>
  );
};

export default Index;
