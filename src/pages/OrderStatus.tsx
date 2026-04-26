import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Zap, ArrowRight, Package, Clock, Activity, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunction } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";

type OrderStatusType = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed";

const STEPS = [
  {
    key: "confirmed",
    label: "Payment Confirmed",
    sub: "Paystack verified your payment",
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    key: "delivering",
    label: "Delivering Data",
    sub: "Sending bundle to your number",
    icon: Zap,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    key: "done",
    label: "Data Delivered",
    sub: "Bundle successfully activated",
    icon: CheckCircle2,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
  },
] as const;

function statusToStep(status: OrderStatusType): number {
  if (status === "fulfilled") return 3;
  if (status === "paid" || status === "processing") return 1;
  return 0;
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const phone = searchParams.get("phone") || "";

  const [orderStatus, setOrderStatus] = useState<OrderStatusType>("pending");
  const [orderType, setOrderType] = useState<string>("data");
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(!reference);
  const [copied, setCopied] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const redirectedRef = useRef(false);

  const copyReceipt = () => {
    const now = new Date().toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    const statusLabel = failed ? "❌ Failed" : step >= 3 ? "✅ Delivered" : "⏳ Processing";
    const lines = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "    SwiftData Ghana — Receipt",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Ref       : ${reference.slice(0, 12).toUpperCase()}`,
      `Date      : ${now}`,
      "─────────────────────────────────",
      ...(network ? [`Network   : ${network}`] : []),
      ...(packageSize ? [`Package   : ${packageSize}`] : []),
      ...(phone ? [`Recipient : ${phone}`] : []),
      `Status    : ${statusLabel}`,
      "─────────────────────────────────",
      "  swiftdataghana.com",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleStatusUpdate = (status: OrderStatusType) => {
    setOrderStatus(status);
    const s = statusToStep(status);
    setStep(s);

    if (status === "fulfillment_failed") {
      setFailed(true);
      return;
    }

    if (status === "fulfilled" && !redirectedRef.current) {
      redirectedRef.current = true;
      const params = new URLSearchParams({ reference, network, package: packageSize, phone, source: "checkout" });
      setTimeout(() => navigate(`/purchase-success?${params.toString()}`, { replace: true }), 1200);
    }
  };

  useEffect(() => {
    if (!reference) return;

    const ch = supabase
      .channel(`order-status-${reference}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${reference}` },
        (payload: any) => {
          if (payload.new?.status) handleStatusUpdate(payload.new.status as OrderStatusType);
        }
      )
      .subscribe();

    channelRef.current = ch;

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      const { data } = await invokePublicFunction("verify-payment", { body: { reference } });
      if (cancelled) return;

      if (data?.status) {
        if (data.order_type) setOrderType(data.order_type);
        handleStatusUpdate(data.status as OrderStatusType);
        setInitialCheckDone(true);
        if (data.status === "fulfilled" || data.status === "fulfillment_failed") {
          clearInterval(timer);
        }
      } else {
        setInitialCheckDone(true);
      }

      if (attempts >= 20) clearInterval(timer);
    };

    void poll();
    const timer = setInterval(poll, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [reference]);

  const hasOrder = Boolean(reference);

  return (
    <div className="min-h-screen bg-[#030305] pt-28 pb-20 px-4">
      <div className="container mx-auto max-w-2xl space-y-8">

        {/* ── Live Tracking Card ── */}
        {hasOrder && (
          <div className="relative group animate-in fade-in slide-in-from-top-4 duration-700">
             {/* Card Ambient Glow */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/10 via-amber-500/5 to-emerald-500/10 rounded-3xl blur opacity-100 transition-opacity" />
            
            <div className="relative rounded-3xl border border-white/10 bg-[#0A0A0C]/90 backdrop-blur-xl overflow-hidden shadow-2xl">
              {/* Header section with gradient */}
              <div className="p-6 border-b border-white/5 bg-gradient-to-br from-white/[0.03] to-transparent">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className={`w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shadow-inner ${step < 3 && !failed ? "animate-pulse" : ""}`}>
                      <img
                        src="/logo.png"
                        alt="SwiftData Ghana"
                        className={`w-10 h-10 rounded-full transition-all duration-1000 ${step < 3 && !failed ? "scale-110 blur-[0.5px]" : ""}`}
                      />
                    </div>
                    {step < 3 && !failed && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-blue-500 border-[3px] border-[#0A0A0C] flex items-center justify-center shadow-lg">
                        <Loader2 className="w-2.5 h-2.5 text-white animate-spin" />
                      </div>
                    )}
                    {step >= 3 && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-[3px] border-[#0A0A0C] flex items-center justify-center shadow-lg">
                        <CheckCircle2 className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-black text-white tracking-tight">
                        {network && packageSize ? `${network} ${packageSize}` : "Order Status"}
                      </h1>
                      {failed ? (
                        <span className="text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">Failed</span>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                          <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Live</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-medium text-white/40 truncate mt-0.5">
                      {phone ? `Recipient: ${phone}` : `Ref: ${reference.slice(0, 12)}...`}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="p-8">
                {failed ? (
                  <div className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-5 animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                        <XCircle className="w-5 h-5 text-red-500" />
                      </div>
                      <div>
                        <p className="font-black text-sm text-red-400">Delivery Interrupted</p>
                        <p className="text-[11px] text-white/40">We encountered an issue with the carrier.</p>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-red-500/10 space-y-3">
                      <p className="text-xs text-white/60 leading-relaxed">
                        Don't worry — your payment is safe. Our team has been notified. Please contact support with this reference:
                        <code className="block mt-2 font-mono text-amber-500 bg-black/40 p-2 rounded-lg border border-white/5">{reference}</code>
                      </p>
                      <button
                        onClick={copyReceipt}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold border transition-all duration-150"
                        style={copied
                          ? { background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.30)", color: "rgb(74,222,128)" }
                          : { background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)" }}
                      >
                        {copied ? <><Check className="w-3.5 h-3.5" /> Receipt Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Receipt</>}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {STEPS.map((s, i) => {
                      const done = step > i;
                      const active = step === i && initialCheckDone;
                      const upcoming = step < i;

                      let label = s.label;
                      let sub = s.sub;

                      if (i === 1) { // Delivering
                        if (orderType === "airtime") { label = "Sending Airtime"; sub = "To your phone number"; }
                        else if (orderType === "utility") { label = "Paying Bill"; sub = "Processing with utility provider"; }
                      } else if (i === 2) { // Done
                        if (orderType === "airtime") { label = "Airtime Sent"; sub = "Transaction completed"; }
                        else if (orderType === "utility") { label = "Payment Success"; sub = "Token/Receipt generated"; }
                      }

                      return (
                        <div key={s.key} className="relative flex gap-6 pb-8 last:pb-0">
                          {/* Connector line */}
                          {i < STEPS.length - 1 && (
                            <div className="absolute left-6 top-10 bottom-0 w-[2px] bg-white/5">
                              <div 
                                className="w-full bg-emerald-500 transition-all duration-1000 ease-out"
                                style={{ height: done ? "100%" : "0%" }}
                              />
                            </div>
                          )}

                          {/* Icon Container */}
                          <div
                            className={`relative w-12 h-12 rounded-2xl border-2 flex items-center justify-center shrink-0 transition-all duration-700 ${
                              done
                                ? "border-emerald-500/50 bg-emerald-500 shadow-lg shadow-emerald-500/20"
                                : active
                                ? "border-amber-400/50 bg-amber-400/10 shadow-lg shadow-amber-400/10"
                                : "border-white/5 bg-white/[0.02]"
                            }`}
                          >
                            {done ? (
                              <CheckCircle2 className="w-5 h-5 text-white" />
                            ) : active ? (
                              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                            ) : (
                              <s.icon className="w-5 h-5 text-white/10" />
                            )}
                          </div>

                          {/* Label + Description */}
                          <div className="pt-1.5 flex-1">
                            <p
                              className={`text-sm font-black tracking-tight transition-colors duration-500 ${
                                done ? "text-emerald-400" : active ? "text-white" : "text-white/20"
                              }`}
                            >
                              {label}
                            </p>
                            <p className={`text-xs mt-1 transition-colors duration-500 ${upcoming ? "text-white/10" : "text-white/40"}`}>
                              {sub}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!initialCheckDone && !failed && (
                  <div className="mt-8 pt-6 border-t border-white/5 flex items-center gap-3 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] animate-pulse">
                    <Activity className="w-3.5 h-3.5" />
                    Connecting to Payment Gateway...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Global Phone Tracker Section ── */}
        <div className="relative">
          <PhoneOrderTracker
            title={hasOrder ? "Related History" : "Find Your Order"}
            subtitle={
              hasOrder
                ? "Full delivery history for this number."
                : "Enter your phone number to check all recent data bundles."
            }
            defaultPhone={phone || undefined}
          />
        </div>
      </div>
    </div>
  );
};

export default OrderStatus;
