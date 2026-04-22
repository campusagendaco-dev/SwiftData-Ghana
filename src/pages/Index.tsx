import { ArrowRight, ShieldCheck, Zap, Store, TrendingUp, CheckCircle2, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

const NETWORK_CARDS = [
  {
    name: "MTN",
    color: "bg-amber-400",
    textColor: "text-black",
    mutedColor: "text-black/60",
    btnColor: "bg-black/10 hover:bg-black/20 text-black",
    samples: ["1GB — GH₵ 4.98", "5GB — GH₵ 21.20", "10GB — GH₵ 42.50", "50GB — GH₵ 199.30"],
  },
  {
    name: "Telecel",
    color: "bg-red-600",
    textColor: "text-white",
    mutedColor: "text-white/60",
    btnColor: "bg-white/10 hover:bg-white/20 text-white",
    samples: ["5GB — GH₵ 23.00", "10GB — GH₵ 41.80", "15GB — GH₵ 58.99", "30GB — GH₵ 125.50"],
  },
  {
    name: "AirtelTigo",
    color: "bg-blue-600",
    textColor: "text-white",
    mutedColor: "text-white/60",
    btnColor: "bg-white/10 hover:bg-white/20 text-white",
    samples: ["1GB — GH₵ 4.30", "5GB — GH₵ 19.85", "8GB — GH₵ 30.59", "9GB — GH₵ 34.20"],
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: "No Account Needed",
    desc: "Pick a bundle and pay directly with card or MoMo. No sign-up, no waiting.",
  },
  {
    icon: ShieldCheck,
    title: "Instant & Secure Delivery",
    desc: "Data lands in seconds after payment. Every transaction is secured by Paystack.",
  },
  {
    icon: TrendingUp,
    title: "Non-Expiry Bundles",
    desc: "All data bundles are non-expiry — use them at your own pace, anytime.",
  },
  {
    icon: Store,
    title: "Agent & Reseller Program",
    desc: "Unlock wholesale rates and launch your own branded Paystack-powered data store.",
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
    a: "Yes! Our agent programme lets you activate a reseller account for a one-time fee, unlock wholesale prices, and get your own online store where customers can buy directly from you via Paystack.",
  },
];

const FaqItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        className="w-full flex items-center justify-between gap-4 py-4 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="font-semibold text-sm">{q}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{a}</p>
      )}
    </div>
  );
};

const Index = () => {
  return (
    <div className="min-h-screen">
      {/* ── Hero ──────────────────────────────────────── */}
      <section className="bg-[#1a1a2e] text-white pt-32 pb-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5 mb-6">
            <img src="/logo.png" alt="SwiftData Ghana" className="w-5 h-5 rounded-full" />
            <span className="text-amber-400 text-xs font-semibold">SwiftData Ghana — No account required</span>
          </div>

          <h1 className="font-display text-4xl md:text-6xl font-black leading-tight mb-4 tracking-tight">
            Buy The Cheapest Non-Expiry<br />
            <span className="text-amber-400">Data Bundles in Ghana</span>
          </h1>
          <p className="text-white/70 mt-4 max-w-2xl mx-auto text-base md:text-lg leading-relaxed">
            Purchase affordable, non-expiry <strong className="text-white/90">MTN data bundles</strong>, <strong className="text-white/90">Telecel data packages</strong>, and <strong className="text-white/90">AirtelTigo internet bundles</strong> directly online. Enjoy instant delivery, secure Paystack payments, and 24/7 availability with no account required.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/buy-data"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-base px-8 py-3.5 transition-colors shadow-lg"
            >
              Buy Data Now <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/agent-program"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 hover:border-white/40 text-white font-semibold text-base px-8 py-3.5 transition-colors"
            >
              Start Selling Data
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-xs text-white/40">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Delivered in seconds</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-blue-400" /> Non-expiry bundles</span>
            <span className="flex items-center gap-1.5">🇬🇭 Ghana's trusted data store</span>
          </div>
        </div>
      </section>

      {/* ── Trust stats ───────────────────────────────── */}
      <section className="bg-amber-400 py-5 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {TRUST_STATS.map((s) => (
              <div key={s.label}>
                <p className="font-black text-black text-xl md:text-2xl">{s.value}</p>
                <p className="text-black/60 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Network preview cards ─────────────────────── */}
      <section className="py-14 px-4 bg-[radial-gradient(ellipse_at_top,hsl(48_96%_53%/0.07),transparent_55%)]">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-2">
              Cheap Data for All Major Networks in Ghana
            </h2>
            <p className="text-muted-foreground text-sm">
              MTN, Telecel &amp; AirtelTigo — non-expiry bundles at the best prices in Ghana. Delivered instantly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NETWORK_CARDS.map((net) => (
              <div key={net.name} className={`${net.color} rounded-2xl p-5 flex flex-col gap-3`}>
                <div>
                  <p className={`${net.textColor} font-black text-2xl`}>{net.name} Data Bundles Ghana</p>
                  <p className={`${net.mutedColor} text-xs mt-0.5`}>Non-expiry · Instant delivery</p>
                </div>
                <div className="space-y-1.5 flex-1">
                  {net.samples.map((s) => (
                    <div key={s} className={`${net.textColor} text-sm font-medium`}>{s}</div>
                  ))}
                  <p className={`${net.mutedColor} text-xs`}>+ more packages available</p>
                </div>
                <Link
                  to="/agent-program"
                  className={`${net.btnColor} rounded-xl py-2.5 text-center text-sm font-bold transition-colors flex items-center justify-center gap-1.5`}
                >
                  Join Reseller Program <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <Link
              to="/agent-program"
              className="inline-flex items-center gap-2 rounded-xl bg-primary hover:opacity-90 text-primary-foreground font-bold text-sm px-8 py-3 transition-all"
            >
              View Agent Prices <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────── */}
      <section className="py-12 px-4 border-t border-border">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-center font-display text-xl md:text-2xl font-bold mb-6">
            Why SwiftData Ghana is #1 for Cheap Data in Ghana
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border bg-card p-5">
                <f.icon className="w-5 h-5 text-primary mb-3" />
                <h3 className="font-display text-base font-bold mb-1">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Order Tracker ─────────────────────────────── */}
      <section className="py-12 px-4 border-t border-border">
        <div className="container mx-auto max-w-4xl">
          <PhoneOrderTracker
            title="Track Your Data Delivery"
            subtitle="Enter the recipient phone number to check payment and delivery status instantly."
          />
        </div>
      </section>

      {/* ── Agent CTA ─────────────────────────────────── */}
      <section className="py-12 px-4 border-t border-border">
        <div className="container mx-auto max-w-4xl">
          <div className="rounded-2xl bg-[#1a1a2e] text-white p-8 flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Store className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Agent & Reseller Program</span>
              </div>
              <h2 className="font-display text-2xl font-bold mb-2">Start Your Data Reselling Business in Ghana</h2>
              <p className="text-white/60 text-sm max-w-md">
                Activate agent access to unlock wholesale MTN, Telecel &amp; AirtelTigo prices, profit tracking, and your own Paystack-powered public store — all in one platform.
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Link
                to="/agent-program"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-sm px-6 py-3 transition-colors"
              >
                Become a Data Agent <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 hover:border-white/40 text-white font-semibold text-sm px-6 py-3 transition-colors"
              >
                Sign In to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────── */}
      <section className="py-12 px-4 border-t border-border">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl font-bold mb-2">
              Frequently Asked Questions
            </h2>
            <p className="text-muted-foreground text-sm">
              Everything you need to know about buying cheap data bundles in Ghana with SwiftData Ghana.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card px-6">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer SEO text ───────────────────────────── */}
      <section className="py-10 px-4 border-t border-border bg-secondary/20">
        <div className="container mx-auto max-w-4xl text-center">
          <img src="/logo.png" alt="SwiftData Ghana" className="w-14 h-14 rounded-full mx-auto mb-3" />
          <p className="font-black text-lg mb-1">SwiftData Ghana</p>
          <p className="text-muted-foreground text-xs max-w-2xl mx-auto leading-relaxed">
            Ghana's #1 cheapest data bundle store — buy non-expiry MTN data bundles, Telecel data bundles and AirtelTigo data bundles online. Instant delivery secured by Paystack. Serving all regions of Ghana 24/7.
          </p>
          <p className="text-muted-foreground text-[10px] mt-4">
            © {new Date().getFullYear()} SwiftData Ghana · swiftdatagh.com · All rights reserved.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Index;
