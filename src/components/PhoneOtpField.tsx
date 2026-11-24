import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Send, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rememberPhoneToken } from "@/lib/phoneVerification";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface PhoneOtpFieldProps {
  phone: string;
  onPhoneChange: (val: string) => void;
  verifiedPhone: string | null;
  onVerified: (normalizedPhone: string, token: string) => void;
  onResetVerification: () => void;
  inputClassName?: string;
  labelClassName?: string;
}

export function normalizeGhanaPhoneInput(raw: string): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("233")) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

export default function PhoneOtpField({
  phone,
  onPhoneChange,
  verifiedPhone,
  onVerified,
  onResetVerification,
  inputClassName = "bg-secondary h-11 rounded-xl",
  labelClassName = "text-xs font-bold",
}: PhoneOtpFieldProps) {
  const { toast } = useToast();
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const normalized = normalizeGhanaPhoneInput(phone);
  const isVerified = Boolean(verifiedPhone && verifiedPhone === normalized);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSendOtp = async () => {
    if (!/^0\d{9}$/.test(normalized)) {
      toast({
        title: "Invalid phone number",
        description: "Enter a valid 10-digit Ghana phone number (e.g. 0541234567).",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signup-phone-otp", {
        body: { action: "send_otp", phone: normalized },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Could not send verification code.");

      setOtpSent(true);
      setOtpCode("");
      setCooldown(60);
      toast({ title: "OTP Sent", description: data.message || `Code sent to ${normalized}` });
    } catch (err: any) {
      toast({
        title: "Failed to send OTP",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const clean = otpCode.replace(/\D+/g, "");
    if (clean.length !== 6) {
      toast({ title: "Enter 6-digit code", description: "Please type the 6 digits sent via SMS.", variant: "destructive" });
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signup-phone-otp", {
        body: { action: "verify_otp", phone: normalized, otp: clean },
      });
      if (error) throw error;
      if (!data?.success || !data?.verified) throw new Error(data?.error || "Invalid verification code.");

      rememberPhoneToken(data.phone || normalized, data.verification_token || "");
      onVerified(data.phone || normalized, data.verification_token || "");
      setOtpSent(false);
      setOtpCode("");
      toast({ title: "Phone Verified", description: "Your phone number is verified." });
    } catch (err: any) {
      toast({
        title: "Verification failed",
        description: err?.message || "Incorrect or expired code.",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="phone" className={labelClassName}>
          Phone Number <span className="text-red-500">*</span>
        </Label>
        {isVerified && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-500">
            <CheckCircle2 className="w-3.5 h-3.5" /> Verified
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          value={phone}
          disabled={isVerified}
          onChange={(e) => {
            onPhoneChange(e.target.value);
            if (otpSent) setOtpSent(false);
            if (verifiedPhone) onResetVerification();
          }}
          placeholder="0541234567"
          className={`flex-1 ${inputClassName}`}
          required
        />
        {isVerified ? (
          <button
            type="button"
            onClick={() => {
              onResetVerification();
              setOtpSent(false);
            }}
            className="px-3 rounded-xl border border-border bg-secondary text-xs font-bold text-muted-foreground hover:text-foreground shrink-0"
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            disabled={sending || cooldown > 0 || !/^0\d{9}$/.test(normalized)}
            onClick={() => void handleSendOtp()}
            className="px-3.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {cooldown > 0 ? `${cooldown}s` : otpSent ? "Resend" : "Send OTP"}
          </button>
        )}
      </div>

      {otpSent && !isVerified && (
        <div className="flex gap-2 pt-0.5">
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
            placeholder="Enter 6-digit SMS code"
            className={`flex-1 font-mono tracking-widest ${inputClassName}`}
          />
          <button
            type="button"
            disabled={verifying || otpCode.length !== 6}
            onClick={() => void handleVerifyOtp()}
            className="px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Verify
          </button>
        </div>
      )}
    </div>
  );
}
