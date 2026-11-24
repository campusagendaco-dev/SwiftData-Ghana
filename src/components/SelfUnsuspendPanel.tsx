import { useEffect, useState } from "react";
import { ShieldCheck, Send, Loader2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type UnsuspendStatus = {
  has_phone: boolean;
  masked_phone: string | null;
  suspension_reason: string;
  is_security_breach: boolean;
  pending_request: { id: string; status: string; created_at: string } | null;
};

export default function SelfUnsuspendPanel() {
  const [loading, setLoading] = useState(true);
  const [statusInfo, setStatusInfo] = useState<UnsuspendStatus | null>(null);
  const [step, setStep] = useState<"idle" | "otp_sent" | "pending_admin" | "restored">("idle");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("self-unsuspend", {
          body: { action: "status" },
        });
        if (!active) return;
        if (error || data?.error) return;
        if (data?.already_active) {
          window.location.reload();
          return;
        }
        setStatusInfo(data as UnsuspendStatus);
        if (data?.pending_request) setStep("pending_admin");
      } catch {
        // non-critical
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleRequestOtp = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("self-unsuspend", {
        body: { action: "request_otp" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStep("otp_sent");
      toast.success(data?.message || "Verification OTP sent to your registered phone.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    const clean = otp.replace(/\D+/g, "");
    if (clean.length !== 6) {
      toast.error("Enter the 6-digit OTP sent to your phone.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("self-unsuspend", {
        body: { action: "verify_otp", otp: clean },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.unsuspended) {
        setStep("restored");
        toast.success(data.message || "Account restored!");
        setTimeout(() => window.location.reload(), 1200);
      } else if (data?.pending_admin_approval) {
        setStep("pending_admin");
        toast.info(data.message || "Phone verified. Admin has been notified for approval.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mb-5 p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking account restriction details...
      </div>
    );
  }

  if (!statusInfo) return null;

  return (
    <div className="mb-5 text-left rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
            Restriction Reason
          </span>
          {statusInfo.is_security_breach && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <AlertTriangle className="w-3 h-3" /> Admin Review
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-200 leading-relaxed">{statusInfo.suspension_reason}</p>
      </div>

      {step === "restored" ? (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 font-semibold">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Account verified & restored! Reloading dashboard...
        </div>
      ) : step === "pending_admin" ? (
        <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-amber-400">
            <Clock className="w-4 h-4 shrink-0" />
            Phone Verified — Awaiting Admin Approval
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            Because this restriction involved a security alert, an instant SMS and live approval notification have been sent to Admin. You'll receive an SMS as soon as it's approved.
          </p>
        </div>
      ) : !statusInfo.has_phone ? (
        <p className="text-[11px] text-zinc-400">
          No phone number is registered on this account for SMS OTP verification. Please contact support below.
        </p>
      ) : step === "otp_sent" ? (
        <div className="space-y-2.5 pt-1">
          <p className="text-[11px] text-zinc-300">
            Enter the 6-digit code sent to <span className="font-mono font-bold text-white">{statusInfo.masked_phone}</span>:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D+/g, "").slice(0, 6))}
              placeholder="000000"
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-2.5 text-center font-mono text-base tracking-[0.35em] text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              disabled={busy || otp.length !== 6}
              onClick={() => void handleVerifyOtp()}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Verify
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRequestOtp()}
            className="text-[11px] text-zinc-400 hover:text-white underline"
          >
            Resend code
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleRequestOtp()}
          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/20"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Verify Phone ({statusInfo.masked_phone}) via OTP to Unsuspend
        </button>
      )}
    </div>
  );
}
