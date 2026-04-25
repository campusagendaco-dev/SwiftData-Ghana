import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Smartphone, Zap, Loader2, CreditCard, Wallet,
  CheckCircle2, Phone, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MTNLogo, TelecelLogo, AirtelTigoLogo } from "@/components/BrandLogos";

type PayMethod = "wallet" | "paystack";

const NETWORKS = [
  { name: "MTN",        Logo: MTNLogo,        accent: "border-yellow-400/40 bg-yellow-400/8",  activeAccent: "border-yellow-400 bg-yellow-400/15" },
  { name: "Telecel",    Logo: TelecelLogo,    accent: "border-red-400/30 bg-red-400/8",         activeAccent: "border-red-400 bg-red-400/15" },
  { name: "AirtelTigo", Logo: AirtelTigoLogo, accent: "border-rose-400/30 bg-rose-400/8",       activeAccent: "border-rose-400 bg-rose-400/15" },
];

const QUICK_AMOUNTS = [1, 2, 5, 10, 20, 50];

const DashboardBuyAirtime = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [network, setNetwork] = useState("MTN");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("paystack");
  const [loading, setLoading] = useState(false);

  const numAmount = Number(amount);
  const canPay = !!phone.trim() && numAmount >= 1;

  const reset = () => {
    setPhone("");
    setAmount("");
  };

  const handlePay = async () => {
    if (!canPay || !user) return;
    setLoading(true);

    if (payMethod === "wallet") {
      // ── TODO: wire up wallet-pay-airtime edge function when API is provided ──
      // const { data, error } = await supabase.functions.invoke("wallet-pay-airtime", {
      //   body: { network, phone: phone.trim(), amount: numAmount },
      // });
      toast({ title: "Airtime API coming soon", description: "Wallet top-up for airtime will be enabled shortly." });
      setLoading(false);
      return;
    }

    // ── Paystack / MoMo flow ──
    const reference = crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: user.email || `${user.id}@swiftdata.gh`,
        amount: numAmount,
        reference,
        callback_url: `${window.location.origin}/dashboard/buy-airtime?ref=${reference}`,
        metadata: {
          order_type: "airtime",   // ── TODO: confirm order_type key with API provider ──
          network,
          phone: phone.trim(),
          amount: numAmount,
          agent_id: user.id,
        },
      },
    });

    if (error || !data?.authorization_url) {
      toast({ title: "Payment init failed", description: error?.message || "Please try again.", variant: "destructive" });
      setLoading(false);
      return;
    }

    window.location.href = data.authorization_url;
  };

  const selectedNet = NETWORKS.find((n) => n.name === network)!;

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-8 animate-in fade-in duration-500">

      {/* Header */}
      <div>
        <h1 className="font-black text-3xl tracking-tight text-foreground mb-1">Buy Airtime</h1>
        <p className="text-muted-foreground text-sm">Top up airtime for any Ghana network instantly.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── Form card ── */}
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 md:p-8 space-y-8">

          {/* Step 1 — Network */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">1</span>
              Select Network
            </p>
            <div className="grid grid-cols-3 gap-3">
              {NETWORKS.map((n) => (
                <button
                  key={n.name}
                  onClick={() => setNetwork(n.name)}
                  className={cn(
                    "relative flex flex-col items-center gap-2.5 py-4 px-3 rounded-2xl border font-bold text-sm transition-all",
                    network === n.name ? n.activeAccent : cn("border-border bg-card/40 hover:bg-card", n.accent.split(" ")[0]),
                  )}
                >
                  <n.Logo size={44} />
                  <span className="text-xs font-black text-foreground">{n.name}</span>
                  {network === n.name && (
                    <CheckCircle2 className="w-4 h-4 text-primary absolute top-2.5 right-2.5" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — Phone number */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">2</span>
              Recipient Phone Number
            </p>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 XXX XXXX"
                maxLength={10}
                className="w-full h-13 pl-10 pr-4 py-3.5 bg-secondary/60 border border-border rounded-2xl text-base font-medium placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Step 3 — Amount */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">3</span>
              Amount (GHS)
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(String(q))}
                  className={cn(
                    "px-4 py-1.5 rounded-xl text-xs font-black border transition-all",
                    amount === String(q)
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-card/50 border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  ₵{q}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-black text-sm">₵</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min={1}
                className="w-full h-14 pl-8 pr-4 bg-secondary/60 border border-border rounded-2xl text-xl font-black placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          {/* Step 4 — Payment method */}
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black mr-2">4</span>
              Payment Method
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(["wallet", "paystack"] as PayMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 h-20 rounded-2xl border font-bold text-sm transition-all",
                    payMethod === m
                      ? "bg-primary/12 border-primary/40 text-foreground shadow-md shadow-primary/10"
                      : "bg-card/50 border-border text-muted-foreground hover:text-foreground hover:bg-card",
                  )}
                >
                  {m === "wallet"
                    ? <Wallet className="w-5 h-5 text-primary" />
                    : <CreditCard className="w-5 h-5 text-primary" />}
                  <span>{m === "wallet" ? "Wallet" : "Card / MoMo"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={loading || !canPay}
            className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground font-black text-base transition-all hover:scale-[1.01] active:scale-[0.99] shadow-xl shadow-primary/25 flex items-center justify-center gap-2"
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Smartphone className="w-5 h-5" />}
            {loading ? "Processing..." : `Top Up${numAmount >= 1 ? ` ₵${numAmount.toFixed(2)}` : ""}`}
          </button>
        </div>

        {/* ── Right summary panel ── */}
        <div className="space-y-5">

          {/* Summary card */}
          <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-sm p-6 space-y-5">
            <h3 className="font-black text-foreground text-base">Summary</h3>

            {/* Network logo */}
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-secondary/40 border border-border">
              <selectedNet.Logo size={36} />
              <div>
                <p className="text-xs text-muted-foreground">Network</p>
                <p className="font-black text-foreground text-sm">{network}</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <SummaryRow label="Phone" value={phone || "—"} />
              <SummaryRow label="Payment" value={payMethod === "wallet" ? "Wallet" : "Card / MoMo"} />
              <div className="pt-3 border-t border-border flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Total</span>
                <span className="font-black text-foreground text-xl">
                  {numAmount >= 1 ? `₵${numAmount.toFixed(2)}` : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Info card */}
          <div
            className="relative overflow-hidden rounded-3xl p-6 space-y-3"
            style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.10) 0%, rgba(245,158,11,0.05) 100%)", border: "1px solid rgba(251,191,36,0.18)" }}
          >
            <div className="absolute -top-8 -right-8 w-28 h-28 bg-amber-400/8 rounded-full blur-2xl pointer-events-none" />
            <h4 className="font-black text-foreground text-sm relative z-10">How it works</h4>
            <ul className="space-y-2.5 relative z-10">
              {[
                "Select your network",
                "Enter the recipient's number",
                "Choose an amount and pay",
                "Airtime credited instantly",
              ].map((step, i) => (
                <li key={step} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="w-4 h-4 rounded-full bg-amber-400/20 text-amber-400 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>

          {/* Reset */}
          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 text-muted-foreground text-xs font-bold hover:text-foreground transition-colors py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Form
          </button>
        </div>
      </div>
    </div>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-bold text-foreground text-right truncate max-w-[160px]">{value}</span>
  </div>
);

export default DashboardBuyAirtime;
