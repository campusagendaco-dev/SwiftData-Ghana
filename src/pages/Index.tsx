import { ArrowRight, ShieldCheck, Zap, Store, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

const NETWORK_CARDS = [
  {
    name: "MTN",
    color: "bg-amber-400",
    textColor: "text-black",
    mutedColor: "text-black/60",
    btnColor: "bg-black/10 hover:bg-black/20 text-black",
    samples: ["1GB — GH₵ 4.45", "5GB — GH₵ 21.20", "10GB — GH₵ 42.50"],
  },
  {
    name: "Telecel",
    color: "bg-red-600",
    textColor: "text-white",
    mutedColor: "text-white/60",
    btnColor: "bg-white/10 hover:bg-white/20 text-white",
    samples: ["5GB — GH₵ 23.00", "10GB — GH₵ 41.80", "15GB — GH₵ 58.99"],
  },
  {
    name: "AirtelTigo",
    color: "bg-blue-600",
    textColor: "text-white",
    mutedColor: "text-white/60",
    btnColor: "bg-white/10 hover:bg-white/20 text-white",
    samples: ["2GB — GH₵ 7.50", "5GB — GH₵ 18.00", "10GB — GH₵ 35.00"],
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: "No Account Needed",
    desc: "Pick a bundle and pay directly with Paystack. No sign-up, no waiting.",
  },
  {
    icon: ShieldCheck,
    title: "Instant & Secure",
    desc: "Data is delivered immediately after payment. All transactions secured by Paystack.",
  },
  {
    icon: TrendingUp,
    title: "Non-Expiry Bundles",
    desc: "All bundles are non-expiry. Use them at your own pace, anytime.",
  },
  {
    icon: Store,
    title: "Agent Program",
    desc: "Activate agent access to unlock cheaper rates and launch your own public store.",
  },
];

const Index = () => {

  return (
    <div className="min-h-screen">
      {/* ── Hero ──────────────────────────────────────── */}
      <section className="bg-[#1a1a2e] text-white pt-32 pb-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-1.5 mb-6">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-400 text-xs font-semibold">No account required</span>
          </div>

          <h1 className="font-display text-4xl md:text-6xl font-black leading-tight mb-4">
            Ghana's Fastest<br />
            <span className="text-amber-400">Data Bundles</span>
          </h1>
          <p className="text-white/60 mt-2 max-w-xl mx-auto text-base md:text-lg">
            MTN · Telecel · AirtelTigo — Non-expiry bundles, instant delivery, no login needed.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/buy-data"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-base px-8 py-3.5 transition-colors shadow-lg"
            >
              Buy Data Now <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 hover:border-white/40 text-white font-semibold text-base px-8 py-3.5 transition-colors"
            >
              Sign In / Agent Dashboard
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-xs text-white/40">
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-400" /> Secured by Paystack</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> Instant delivery</span>
            <span className="flex items-center gap-1.5"><span className="text-blue-400">●</span> Non-expiry</span>
          </div>
        </div>
      </section>

      {/* ── Network preview cards ─────────────────────── */}
      <section className="py-14 px-4 bg-[radial-gradient(ellipse_at_top,hsl(48_96%_53%/0.07),transparent_55%)]">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold mb-2">All Major Networks</h2>
            <p className="text-muted-foreground text-sm">Choose any network below and get your bundle in minutes.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NETWORK_CARDS.map((net) => (
              <div key={net.name} className={`${net.color} rounded-2xl p-5 flex flex-col gap-3`}>
                <div>
                  <p className={`${net.textColor} font-black text-2xl`}>{net.name}</p>
                  <p className={`${net.mutedColor} text-xs mt-0.5`}>Non-expiry data bundles</p>
                </div>
                <div className="space-y-1.5 flex-1">
                  {net.samples.map((s) => (
                    <div key={s} className={`${net.textColor} text-sm font-medium`}>
                      {s}
                    </div>
                  ))}
                  <p className={`${net.mutedColor} text-xs`}>+ more packages available</p>
                </div>
                <Link
                  to="/buy-data"
                  className={`${net.btnColor} rounded-xl py-2.5 text-center text-sm font-bold transition-colors flex items-center justify-center gap-1.5`}
                >
                  Buy {net.name} Data <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────── */}
      <section className="py-12 px-4 border-t border-border">
        <div className="container mx-auto max-w-5xl">
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
      <section className="py-12 px-4">
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
                <span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Agent Program</span>
              </div>
              <h3 className="font-display text-2xl font-bold mb-2">Start Your Data Business</h3>
              <p className="text-white/60 text-sm max-w-md">
                Activate agent access to unlock wholesale bundle rates, profit tracking, and your own Paystack-powered public store.
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Link
                to="/agent-program"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-sm px-6 py-3 transition-colors"
              >
                Become an Agent <ArrowRight className="w-4 h-4" />
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

    </div>
  );
};

export default Index;
