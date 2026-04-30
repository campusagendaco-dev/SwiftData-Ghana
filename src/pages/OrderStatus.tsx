import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2, XCircle, Loader2, ShieldCheck, Zap,
  Activity, Copy, Check, RefreshCw, ArrowLeft,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import PhoneOrderTracker from "@/components/PhoneOrderTracker";
import { useAuth } from "@/hooks/useAuth";

type OrderStatusType = "pending" | "paid" | "processing" | "fulfilled" | "fulfillment_failed";

const STEPS = [
  { key: "confirmed", icon: ShieldCheck },
  { key: "delivering", icon: Zap },
  { key: "done", icon: CheckCircle2 },
];

function getStepLabels(index: number, orderType: string) {
  if (index === 0) return { label: "Payment Confirmed", sub: "Paystack verified your payment" };
  if (index === 1) {
    if (orderType === "airtime") return { label: "Sending Airtime", sub: "Topping up your phone number" };
    if (orderType === "utility") return { label: "Processing Bill", sub: "Paying with utility provider" };
    return { label: "Delivering Data", sub: "Sending bundle to your number" };
  }
  if (orderType === "airtime") return { label: "Airtime Sent", sub: "Transaction completed" };
  if (orderType === "utility") return { label: "Bill Paid", sub: "Token/Receipt generated" };
  return { label: "Data Delivered", sub: "Bundle successfully activated" };
}

function statusToStep(status: OrderStatusType): number {
  if (status === "fulfilled") return 3;
  if (status === "paid" || status === "processing") return 1;
  return 0;
}

function getStatusMeta(status: OrderStatusType, failed: boolean, message?: string) {
  if (failed || status === "fulfillment_failed") {
    return { color: "#EF4444", glow: "rgba(239,68,68,0.12)", label: "Delivery Failed", sub: message || "Something went wrong with your order", badge: "Failed" };
  }
  if (status === "fulfilled") {
    return { color: "#10B981", glow: "rgba(16,185,129,0.10)", label: "Order Delivered!", sub: "Your order has been fulfilled successfully", badge: "Complete" };
  }
  if (status === "processing") {
    return { color: "#8B5CF6", glow: "rgba(139,92,246,0.10)", label: "Live Tracking", sub: message || "Order accepted by network provider", badge: "Live" };
  }
  if (status === "paid") {
    return { color: "#F59E0B", glow: "rgba(245,158,11,0.10)", label: "Processing Payment", sub: "Preparing to fulfill your order", badge: "Live" };
  }
  return { color: "#6366F1", glow: "rgba(99,102,241,0.08)", label: "Awaiting Payment", sub: "Waiting for payment confirmation", badge: "Pending" };
}

const OrderStatus = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref") || "";
  const network = searchParams.get("network") || "";
  const packageSize = searchParams.get("package") || "";
  const phone = searchParams.get("phone") || "";

  const [orderStatus, setOrderStatus] = useState<OrderStatusType>("pending");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [providerId, setProviderId] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAuth();
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

  const handleStatusUpdate = (status: OrderStatusType, message?: string, pId?: string) => {
    setOrderStatus(status);
    setStep(statusToStep(status));
    if (message) setStatusMessage(message);
    if (pId) setProviderId(pId);

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
        handleStatusUpdate(data.status as OrderStatusType, data.message, data.provider_order_id);
        setInitialCheckDone(true);
        if (data.status === "fulfilled" || data.status === "fulfillment_failed") clearInterval(timer);
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
  }, [reference, handleStatusUpdate]);

  const manualCheck = async () => {
    if (!reference || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const { data } = await invokePublicFunctionAsUser("verify-payment", { body: { reference } });
      if (data?.status) {
        if (data.order_type) setOrderType(data.order_type);
        handleStatusUpdate(data.status as OrderStatusType, data.message, data.provider_order_id);
      }
    } catch { /* ignore */ }
    finally { setIsRefreshing(false); }
  };

  const hasOrder = Boolean(reference);
  const meta = getStatusMeta(orderStatus, failed, statusMessage);
  const isLive = !failed && step < 3;
  const isComplete = !failed && step >= 3;

  return (
    <div className="min-h-screen bg-[#030305] pt-24 pb-24 px-4 relative overflow-hidden">
      {/* Dynamic ambient page glow */}
      <div
        className="pointer-events-none fixed inset-0 transition-all duration-[1500ms]"
        style={{ background: `radial-gradient(ellipse 900px 600px at 50% -5%, ${meta.glow} 0%, transparent 70%)` }}
      />

      <div className="relative container mx-auto max-w-md">
        {/* Back navigation */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 flex items-center gap-2 text-white/25 hover:text-white/55 transition-colors text-xs font-bold uppercase tracking-widest"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        {/* Page header */}
        <div className="mb-7">
          <h1 className="text-[1.75rem] font-black text-white tracking-tight leading-none">Track Order</h1>
          <p className="text-xs text-white/25 font-semibold mt-1.5 tracking-wide">Real-time delivery status</p>
        </div>

        <div className="space-y-4">
          {hasOrder && (
            <div
              className="relative rounded-[2rem] overflow-hidden shadow-2xl animate-in fade-in slide-in-from-top-4 duration-700"
              style={{
                background: "linear-gradient(180deg, #0C0C16 0%, #080810 100%)",
                border: `1px solid ${meta.color}18`,
                boxShadow: `0 0 80px ${meta.color}07, 0 28px 56px rgba(0,0,0,0.6)`,
              }}
            >
              {/* Top edge highlight */}
              <div
                className="absolute top-0 left-0 right-0 h-px pointer-events-none"
                style={{ background: `linear-gradient(90deg, transparent 0%, ${meta.color}35 50%, transparent 100%)` }}
              />

              {/* ── Card Header ── */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4">
                <div className="flex items-center gap-2.5">
                  <img src="/logo.png" alt="" className="w-6 h-6 rounded-lg opacity-55" />
                  <span className="text-[10px] font-black text-white/25 uppercase tracking-[0.22em]">SwiftData Ghana</span>
                </div>

                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                  style={{ background: `${meta.color}10`, border: `1px solid ${meta.color}22` }}
                >
                  {isLive && (
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-ping"
                      style={{ backgroundColor: meta.color }}
                    />
                  )}
                  {isComplete && <CheckCircle2 className="w-3 h-3" style={{ color: meta.color }} />}
                  {failed && <XCircle className="w-3 h-3" style={{ color: meta.color }} />}
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: meta.color }}>
                    {meta.badge}
                  </span>
                </div>
              </div>

              {/* ── Status Hero ── */}
              <div className="flex flex-col items-center px-6 pt-4 pb-8">
                {/* Layered glow icon */}
                <div className="relative mb-6 flex items-center justify-center">
                  {isLive && (
                    <div
                      className="absolute w-32 h-32 rounded-[2.5rem] animate-ping opacity-[0.05]"
                      style={{ backgroundColor: meta.color, animationDuration: "2.5s" }}
                    />
                  )}
                  <div
                    className="absolute w-28 h-28 rounded-[2.5rem] blur-2xl opacity-[0.22] transition-all duration-1000"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div
                    className="relative w-24 h-24 rounded-[1.75rem] flex items-center justify-center transition-all duration-700"
                    style={{
                      background: `radial-gradient(circle at 40% 30%, ${meta.color}18 0%, ${meta.color}05 100%)`,
                      border: `1.5px solid ${meta.color}22`,
                      boxShadow: `0 0 50px ${meta.color}15, inset 0 1px 0 ${meta.color}12`,
                    }}
                  >
                    {isLive ? (
                      <Loader2 className="w-12 h-12 animate-spin" style={{ color: meta.color }} />
                    ) : failed ? (
                      <XCircle className="w-12 h-12" style={{ color: meta.color }} />
                    ) : (
                      <CheckCircle2 className="w-12 h-12" style={{ color: meta.color }} />
                    )}
                  </div>
                </div>

                <h2 className="text-2xl font-black text-white tracking-tight text-center leading-tight">
                  {meta.label}
                </h2>
                <p className="text-sm text-white/30 font-medium mt-2 text-center max-w-[240px]">
                  {meta.sub}
                </p>

                {/* Order identity chip */}
                {(network || phone) && (
                  <div
                    className="flex items-center gap-2 mt-5 px-4 py-2.5 rounded-2xl"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.055)" }}
                  >
                    {network && <span className="text-xs font-black text-white/60">{network}</span>}
                    {network && packageSize && <span className="text-white/15 text-xs">·</span>}
                    {packageSize && <span className="text-xs font-semibold text-white/40">{packageSize}</span>}
                    {(network || packageSize) && phone && <span className="text-white/15 text-xs">·</span>}
                    {phone && <span className="text-xs font-mono text-white/35">{phone}</span>}
                  </div>
                )}

                {providerId && (
                  <div className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                    <Activity className="w-3 h-3 text-purple-400 opacity-60" />
                    <span className="text-[10px] font-bold text-white/20 uppercase tracking-wider">Network ID:</span>
                    <span className="text-[10px] font-mono text-purple-300/40">{providerId}</span>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="mx-6 h-px" style={{ background: "rgba(255,255,255,0.04)" }} />

              {/* ── Card Body ── */}
              <div className="p-6 space-y-4">

                {/* Progress Stepper */}
                {!failed && (
                  <div
                    className="rounded-2xl p-5"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    {STEPS.map((s, i) => {
                      const done = step > i;
                      const active = step === i && initialCheckDone;
                      const upcoming = step < i;
                      const { label, sub } = getStepLabels(i, orderType);

                      return (
                        <div key={s.key} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div
                              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-700"
                              style={
                                done
                                  ? { background: "rgba(16,185,129,0.12)", border: "1.5px solid rgba(16,185,129,0.35)", boxShadow: "0 0 14px rgba(16,185,129,0.12)" }
                                  : active
                                  ? { background: `${meta.color}12`, border: `1.5px solid ${meta.color}38`, boxShadow: `0 0 14px ${meta.color}12` }
                                  : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }
                              }
                            >
                              {done ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : active ? (
                                <Loader2 className="w-4 h-4 animate-spin" style={{ color: meta.color }} />
                              ) : (
                                <s.icon className="w-4 h-4 text-white/10" />
                              )}
                            </div>
                            {i < STEPS.length - 1 && (
                              <div className="w-px my-2 flex-1 min-h-[1.5rem] bg-white/[0.035] relative overflow-hidden">
                                <div
                                  className="absolute top-0 left-0 right-0 bg-emerald-500/40 transition-all duration-1000 ease-out"
                                  style={{ height: done ? "100%" : "0%" }}
                                />
                              </div>
                            )}
                          </div>

                          <div className={`flex-1 pt-1.5 ${i < STEPS.length - 1 ? "pb-5" : ""}`}>
                            <p
                              className="text-sm font-black tracking-tight transition-colors duration-500"
                              style={
                                done ? { color: "#10B981" }
                                  : active ? { color: "#FFFFFF" }
                                  : { color: "rgba(255,255,255,0.15)" }
                              }
                            >
                              {label}
                            </p>
                            <p
                              className="text-xs mt-0.5 font-medium transition-colors duration-500"
                              style={{ color: upcoming ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.28)" }}
                            >
                              {sub}
                            </p>
                            {active && (
                              <div className="mt-2.5 flex items-center gap-1">
                                {[0, 150, 300].map((delay) => (
                                  <div
                                    key={delay}
                                    className="w-1 h-1 rounded-full animate-bounce"
                                    style={{ backgroundColor: meta.color, animationDelay: `${delay}ms`, opacity: 0.65 }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Failed State */}
                {failed && (
                  <div
                    className="rounded-2xl p-5 space-y-4"
                    style={{ background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.12)" }}
                  >
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/20 mb-2">
                        Transaction Reference
                      </p>
                      <div className="relative">
                        <code
                          className="block w-full text-xs font-mono px-4 py-3 rounded-xl pr-12 break-all"
                          style={{ color: "rgba(251,191,36,0.65)", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)" }}
                        >
                          {reference}
                        </code>
                        <button
                          onClick={copyReceipt}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all hover:bg-white/10"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/25" />}
                        </button>
                      </div>
                    </div>

                    {user ? (
                      <button
                        onClick={manualCheck}
                        disabled={isRefreshing}
                        className="w-full h-11 rounded-xl text-sm font-black text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)", boxShadow: "0 4px 20px rgba(239,68,68,0.25)" }}
                      >
                        {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Retry Fulfillment
                      </button>
                    ) : (
                      <a
                        href="https://wa.me/233540000000"
                        target="_blank"
                        rel="noreferrer"
                        className="w-full h-11 rounded-xl text-sm font-black text-white flex items-center justify-center gap-2 transition-all hover:opacity-80"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        Contact Support
                      </a>
                    )}

                    <p className="text-center text-[9px] font-black uppercase tracking-[0.2em] text-white/15">
                      Your payment is safe · We'll resolve this
                    </p>
                  </div>
                )}

                {/* Reference + copy (non-failed) */}
                {!failed && (
                  <div
                    className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20 mb-0.5">Reference</p>
                      <code className="text-[11px] font-mono text-white/38 truncate block">{reference.slice(0, 20)}...</code>
                    </div>
                    <button
                      onClick={copyReceipt}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0 transition-all text-[10px] font-black uppercase tracking-widest"
                      style={{
                        background: copied ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.04)",
                        border: copied ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(255,255,255,0.06)",
                        color: copied ? "#10B981" : "rgba(255,255,255,0.32)",
                      }}
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}

                {/* Footer: live status + manual refresh */}
                {!failed && (
                  <div className="flex items-center justify-between pt-0.5">
                    {!initialCheckDone ? (
                      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/18 animate-pulse">
                        <Activity className="w-3 h-3" />
                        Connecting...
                      </div>
                    ) : isLive ? (
                      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/18">
                        <Activity className="w-3 h-3" />
                        Live tracking active
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em]"
                        style={{ color: "rgba(16,185,129,0.45)" }}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Order complete
                      </div>
                    )}

                    {isLive && (
                      <button
                        onClick={manualCheck}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-75"
                        style={{ color: meta.color }}
                      >
                        {isRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Check Now
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Phone Order Tracker */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
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
    </div>
  );
};

export default OrderStatus;
