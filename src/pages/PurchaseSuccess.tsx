import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, Copy, Home, Loader2, ReceiptText, Share2, ShieldCheck, ShoppingBag, Smartphone, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { playSuccessSound } from "@/lib/sound";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { cn } from "@/lib/utils";

type Phase = "confirming" | "paid" | "sending" | "delivered" | "failed";

const CONFETTI_COLORS = ["#ffd43b", "#ff9f1c", "#22c55e", "#0ea5e9", "#f472b6", "#e11d48"];

const formatPhone = (value: string) => {
  const d = value.replace(/\D+/g, "");
  const local = d.length === 12 && d.startsWith("233") ? `0${d.slice(3)}` : d;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : value;
};

const phaseFromStatus = (s?: string | null): Phase => {
  switch (String(s || "").toLowerCase()) {
    case "fulfilled":
    case "completed":
    case "delivered":
      return "delivered";
    case "processing":
      return "sending";
    case "paid":
      return "paid";
    case "fulfillment_failed":
    case "failed":
    case "error":
    case "refunded":
      return "failed";
    default:
      return "confirming";
  }
};

const COPY: Record<Phase, { title: string; sub: string }> = {
  confirming: { title: "Confirming your payment", sub: "Hang tight, this usually takes a few seconds." },
  paid: { title: "Payment received", sub: "Your order is queued and will be sent to the network shortly." },
  sending: { title: "Payment received", sub: "We’re sending your order to the network now." },
  delivered: { title: "Delivered!", sub: "Your order has arrived. Thanks for buying with SwiftData." },
  failed: { title: "Delivery needs attention", sub: "Your payment is safe. Track the order for a retry or refund." },
};

const PurchaseSuccess = () => {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || "";
  const qsNetwork = searchParams.get("network") || "";
  const qsPackage = searchParams.get("package") || "";
  const qsPhone = searchParams.get("phone") || "";
  let slug = searchParams.get("slug") || "";
  if (!slug || slug === "undefined" || slug === "null") {
    try {
      const saved = localStorage.getItem("current_store_tenant");
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed?.slug) slug = parsed.slug;
    } catch {
      /* ignore */
    }
  }
  const storeUrl = slug && slug !== "undefined" && slug !== "null" ? `/store/${slug}` : null;

  const [phase, setPhase] = useState<Phase>(reference ? "confirming" : "paid");
  const [order, setOrder] = useState<{ network?: string; package_size?: string; customer_phone?: string; amount?: number; order_type?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const verifiedOnce = useRef(false);
  const startedAt = useRef(Date.now());
  const celebrated = useRef(false);

  const network = order?.network || qsNetwork;
  const packageSize = order?.package_size || qsPackage;
  const phone = formatPhone(order?.customer_phone || qsPhone);

  const poll = useCallback(async () => {
    if (!reference) return;
    try {
      const { data } = await (supabase.rpc as any)("get_public_order_status", { p_reference: reference });
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        setOrder(row);
        setPhase(phaseFromStatus(row.status));
      }
      const p = row ? phaseFromStatus(row.status) : "confirming";
      // If the payment still isn't confirmed after a few seconds, ask the server to verify it once.
      if (p === "confirming" && !verifiedOnce.current && Date.now() - startedAt.current > 6000) {
        verifiedOnce.current = true;
        const { data: v } = await supabase.functions.invoke("verify-payment", { body: { reference, force: true } });
        if (v?.order) setOrder(v.order);
        if (v?.status) setPhase(phaseFromStatus(v.status));
      }
    } catch {
      /* keep the last known state; the next tick retries */
    }
  }, [reference]);

  useEffect(() => {
    if (!reference) return;
    poll();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Stop after 5 minutes; the tracker page takes over from there.
      if (Date.now() - startedAt.current > 5 * 60_000) return clearInterval(id);
      poll();
    }, 4000);
    return () => clearInterval(id);
  }, [reference, poll]);

  // Celebrate once, as soon as payment is confirmed.
  useEffect(() => {
    if (celebrated.current) return;
    if (phase === "paid" || phase === "sending" || phase === "delivered") {
      celebrated.current = true;
      setCelebrate(true);
      playSuccessSound();
    }
  }, [phase]);

  const steps = [
    { key: "pay", label: "Payment confirmed", done: phase !== "confirming", active: phase === "confirming" },
    { key: "send", label: "Sent to network", done: phase === "delivered" || phase === "failed", active: phase === "paid" || phase === "sending" },
    { key: "deliver", label: phase === "failed" ? "Delivery failed" : "Delivered", done: phase === "delivered", active: false, failed: phase === "failed" },
  ];

  const statusText: Record<Phase, string> = {
    confirming: "Confirming payment",
    paid: "Paid · queued",
    sending: "Paid · sending",
    delivered: "Delivered",
    failed: "Delivery failed",
  };

  const receiptText = () => {
    const now = new Date().toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
    return [
      "SwiftData Ghana — Receipt",
      `Ref: ${reference.slice(0, 16).toUpperCase()}`,
      `Date: ${now}`,
      ...(network ? [`Network: ${network}`] : []),
      ...(packageSize ? [`Package: ${packageSize}`] : []),
      ...(phone ? [`Recipient: ${phone}`] : []),
      ...(order?.amount ? [`Amount: GH₵${Number(order.amount).toFixed(2)}`] : []),
      `Status: ${statusText[phase]}`,
      "swiftdatagh.shop",
    ].join("\n");
  };

  const shareReceipt = async () => {
    const text = receiptText();
    try {
      if (navigator.share) {
        await navigator.share({ title: "SwiftData receipt", text });
        return;
      }
    } catch {
      /* fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 7 + Math.random() * 8,
        delay: Math.random() * 1.2,
        duration: 2.4 + Math.random() * 1.8,
        rotation: Math.random() * 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    []
  );

  const c = COPY[phase];
  const tone =
    phase === "delivered"
      ? "bg-emerald-500 text-white"
      : phase === "failed"
      ? "bg-amber-500 text-white"
      : phase === "confirming"
      ? "bg-muted text-muted-foreground"
      : "bg-primary text-primary-foreground";

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center px-4 pt-24 pb-10 text-foreground">
      {celebrate && (
        <div className="ps-confetti" aria-hidden>
          {confetti.map((p) => (
            <span
              key={p.id}
              className="ps-confetti-piece"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size * 0.45}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                transform: `rotate(${p.rotation}deg)`,
                backgroundColor: p.color,
              }}
            />
          ))}
        </div>
      )}

      <main className="relative z-10 w-full max-w-[440px]">
        <section className="rounded-[28px] border border-border bg-card/90 backdrop-blur-xl shadow-[0_30px_80px_-30px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Status hero */}
          <div className="px-6 pt-8 pb-6 text-center">
            <div className="relative mx-auto h-20 w-20">
              {phase !== "failed" && phase !== "delivered" && <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "2s" }} />}
              <span className={cn("absolute inset-0 rounded-full flex items-center justify-center shadow-lg transition-colors duration-500", tone)}>
                {phase === "delivered" ? (
                  <CheckCircle2 className="h-10 w-10" />
                ) : phase === "failed" ? (
                  <AlertTriangle className="h-9 w-9" />
                ) : phase === "confirming" ? (
                  <Loader2 className="h-9 w-9 animate-spin" />
                ) : (
                  <Wifi className="h-9 w-9" />
                )}
              </span>
            </div>
            <h1 className="mt-5 text-[26px] font-bold tracking-[-0.02em] leading-tight" aria-live="polite">
              {c.title}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground max-w-[320px] mx-auto">{c.sub}</p>
          </div>

          {/* Progress */}
          {reference && (
            <ol className="mx-6 mb-5 rounded-2xl border border-border bg-muted/30 p-4 space-y-3" aria-label="Order progress">
              {steps.map((s) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors",
                      s.failed ? "bg-amber-500 text-white" : s.done ? "bg-emerald-500 text-white" : s.active ? "bg-primary/15 text-primary ring-2 ring-primary/30" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {s.failed ? "!" : s.done ? <Check className="h-3.5 w-3.5" /> : s.active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </span>
                  <span className={cn("text-[13.5px]", s.done || s.active || s.failed ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.label}</span>
                </li>
              ))}
            </ol>
          )}

          {/* Details */}
          <dl className="mx-6 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            {[
              { k: "Network", v: network, icon: Wifi },
              { k: "Package", v: packageSize, icon: ShoppingBag },
              { k: "Recipient", v: phone, icon: Smartphone },
              { k: "Reference", v: reference ? reference.slice(0, 14).toUpperCase() : "", icon: ReceiptText },
            ].map((x) => (
              <div key={x.k} className="min-w-0">
                <dt className="text-[11.5px] text-muted-foreground flex items-center gap-1">
                  <x.icon className="h-3.5 w-3.5" /> {x.k}
                </dt>
                <dd className="mt-0.5 font-semibold truncate tabular-nums">{x.v || "—"}</dd>
              </div>
            ))}
          </dl>

          {/* Actions */}
          <div className="p-6 space-y-2.5">
            {storeUrl && (
              <Link to={storeUrl} className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold flex items-center justify-center gap-2 shadow-sm hover:brightness-105">
                <ShoppingBag className="h-4 w-4" /> Buy another bundle
              </Link>
            )}
            <Link
              to={`/order-status?ref=${encodeURIComponent(reference)}`}
              className={cn(
                "w-full h-12 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition",
                storeUrl ? "border border-input bg-background hover:bg-muted" : "bg-primary text-primary-foreground shadow-sm hover:brightness-105"
              )}
            >
              <ReceiptText className="h-4 w-4" /> Track order
            </Link>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" onClick={shareReceipt} className="h-11 rounded-xl border border-input bg-background text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-muted">
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-500" /> Copied
                  </>
                ) : (
                  <>
                    {typeof navigator !== "undefined" && "share" in navigator ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Receipt
                  </>
                )}
              </button>
              <Link to="/" className="h-11 rounded-xl border border-input bg-background text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-muted">
                <Home className="h-4 w-4" /> Home
              </Link>
            </div>

            {phase !== "failed" && (
              <div className="pt-1">
                <PushNotificationPrompt variant="inline" title="Get a delivery alert" description="We’ll ping your lock screen for this and future deliveries." buttonText="Alert me" />
              </div>
            )}
          </div>

          <div className="border-t border-border/70 px-6 py-3 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Status is checked live with our servers
          </div>
        </section>
      </main>

      <style>{`
        .ps-confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 5; }
        .ps-confetti-piece { position: absolute; top: -20px; opacity: 0; border-radius: 2px; animation: ps-fall linear forwards; }
        @keyframes ps-fall {
          0% { transform: translateY(0) rotate(0); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) { .ps-confetti { display: none; } }
      `}</style>
    </div>
  );
};

export default PurchaseSuccess;
