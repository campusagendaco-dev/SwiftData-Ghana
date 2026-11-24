import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, Lock, ArrowRight, Loader2, AlertCircle, Smartphone, KeyRound, Send } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const VerifyMfa = () => {
  const { user, isAdmin, loading: authLoading, refreshMfaStatus, refreshAdminOtpStatus } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [method, setMethod] = useState<"totp" | "otp">(searchParams.get("mode") === "otp" ? "otp" : "totp");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [adminOtpInfo, setAdminOtpInfo] = useState<{ eligible: boolean; masked_phone: string | null } | null>(null);
  const [smsSent, setSmsSent] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const verifyingRef = useRef(false);
  const verifiedSuccessRef = useRef(false);
  const lastSubmittedCodeRef = useRef<string>("");

  // Fetch active MFA TOTP factor on load
  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      navigate("/login");
      return;
    }
    if (verifiedSuccessRef.current) return;

    let cancelled = false;
    const initializeFactor = async () => {
      try {
        // 1. Retrieve list of enrolled factors
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        if (cancelled) return;

        const verifiedFactors = (factorsData?.all || []).filter(f => f.status === "verified");
        if (verifiedFactors.length === 0) {
          // If this is an approved admin without TOTP enrolled, let them use Admin SMS OTP instead of signing them out
          if (isAdmin) {
            setMethod("otp");
            return;
          }
          // Intelligent Self-Healing Recovery Loop Breaker!
          console.warn("[MFA Recovery] No active factors found on server. Clearing stale session.");
          await supabase.auth.signOut({ scope: "local" });
          
          toast.success("Security settings reset! Please enter your password one more time to log in.", { duration: 6000 });
          navigate("/login");
          return;
        }

        const totpFactor = verifiedFactors[0];
        setFactorId(prev => prev === totpFactor.id ? prev : totpFactor.id);
      } catch (e: any) {
        if (cancelled) return;
        console.error("[MFA Init] Factor initialization error:", e);
        setError("Could not initialize secure connection. Please try again.");
      }
    };

    void initializeFactor();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, isAdmin, navigate]);

  // Check server-side if caller is an approved admin eligible for Admin SMS OTP (works at AAL1 before 2FA)
  useEffect(() => {
    if (authLoading || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("admin-otp-auth", {
          body: { action: "status" },
        });
        if (cancelled) return;
        if (data?.has_valid_session) {
          verifiedSuccessRef.current = true;
          await refreshAdminOtpStatus();
          navigate("/admin", { replace: true });
          return;
        }
        if (data?.success && data?.eligible) {
          setAdminOtpInfo({ eligible: true, masked_phone: data.masked_phone || null });
        } else {
          setAdminOtpInfo({ eligible: false, masked_phone: null });
        }
      } catch {
        // non-critical
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, navigate, refreshAdminOtpStatus]);

  const handleRequestAdminSmsOtp = async () => {
    setSendingSms(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("admin-otp-auth", {
        body: { action: "request_otp" },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setSmsSent(true);
      setOtp(["", "", "", "", "", ""]);
      toast.success(data?.message || "Admin verification code sent via SMS.");
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      setError(err?.message || "Could not send Admin OTP.");
    } finally {
      setSendingSms(false);
    }
  };

  // Automatically refocus the first box on load
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const pasted = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    lastSubmittedCodeRef.current = "";
    if (error) setError("");

    const nextOtp = [...otp];
    const startIdx = pasted.length === 6 ? 0 : index;
    pasted.split("").forEach((digit, i) => {
      if (startIdx + i < 6) {
        nextOtp[startIdx + i] = digit;
      }
    });
    setOtp(nextOtp);
    const nextFocus = Math.min(startIdx + pasted.length, 5);
    inputRefs.current[nextFocus]?.focus();
  };

  const handleOtpChange = (element: HTMLInputElement, index: number) => {
    const value = element.value.replace(/\D/g, ""); // Allow digits only
    lastSubmittedCodeRef.current = "";
    if (error) setError("");

    if (!value) {
      const nextOtp = [...otp];
      nextOtp[index] = "";
      setOtp(nextOtp);
      return;
    }

    const nextOtp = [...otp];
    // Handle single-digit replacement when input already contained 1 digit
    if (value.length === 2 && otp[index].length === 1) {
      const replacement = value.startsWith(otp[index]) ? value.slice(1) : value.slice(0, 1);
      nextOtp[index] = replacement;
      setOtp(nextOtp);
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
      return;
    }

    // Handle pasting / autofilling multiple digits
    if (value.length > 1) {
      const cleanDigits = value.length >= 6 && otp[index] && value.startsWith(otp[index]) && value.length > 6
        ? value.slice(1, 7)
        : value.slice(0, 6);
      const startIdx = cleanDigits.length === 6 ? 0 : index;
      const pastedValues = cleanDigits.split("");
      pastedValues.forEach((v, i) => {
        if (startIdx + i < 6) nextOtp[startIdx + i] = v;
      });
      setOtp(nextOtp);
      // Focus next empty or last index
      const nextFocus = Math.min(startIdx + pastedValues.length, 5);
      inputRefs.current[nextFocus]?.focus();
    } else {
      nextOtp[index] = value;
      setOtp(nextOtp);
      // Focus next box
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      lastSubmittedCodeRef.current = "";
      if (!otp[index] && index > 0) {
        // Backspace into previous element
        const nextOtp = [...otp];
        nextOtp[index - 1] = "";
        setOtp(nextOtp);
        inputRefs.current[index - 1]?.focus();
      } else {
        const nextOtp = [...otp];
        nextOtp[index] = "";
        setOtp(nextOtp);
      }
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (verifyingRef.current || verifiedSuccessRef.current || loading) {
      return;
    }

    const fullCode = otp.join("").replace(/\D/g, "");
    if (fullCode.length !== 6) {
      if (e) setError("Please enter all 6 digits.");
      return;
    }

    if (method === "totp" && !factorId) {
      if (e) setError("Authentication session not ready. Please refresh.");
      return;
    }

    if (lastSubmittedCodeRef.current === fullCode) {
      return;
    }

    verifyingRef.current = true;
    lastSubmittedCodeRef.current = fullCode;
    setLoading(true);
    setError("");

    try {
      if (method === "otp") {
        const { data, error: verifyErr } = await supabase.functions.invoke("admin-otp-auth", {
          body: { action: "verify_otp", otp: fullCode },
        });
        if (verifyErr) throw verifyErr;
        if (data?.error) throw new Error(data.error);

        verifiedSuccessRef.current = true;
        toast.success("Admin SMS OTP verified! Welcome back.");
        await refreshAdminOtpStatus();
        navigate("/admin", { replace: true });
        return;
      }
      // If session already reached AAL2 (e.g. concurrent verification), skip duplicate verify call
      if (typeof supabase.auth.mfa.getAuthenticatorAssuranceLevel === "function") {
        const aalRes = await supabase.auth.mfa.getAuthenticatorAssuranceLevel().catch(() => ({ data: null }));
        if (aalRes?.data?.currentLevel === "aal2") {
          verifiedSuccessRef.current = true;
          await refreshMfaStatus();
          navigate("/dashboard", { replace: true });
          return;
        }
      }

      // 1. Create a fresh challenge immediately before verification
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      });
      
      if (challengeError) {
        throw challengeError;
      }

      // 2. Immediately verify the challenge
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: fullCode,
      });

      if (verifyError) {
        throw verifyError;
      }

      verifiedSuccessRef.current = true;
      toast.success("Secure login verified! Welcome back.");
      await refreshMfaStatus();
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const isTotpErr = (err.message || "").toLowerCase().includes("totp") || (err.message || "").toLowerCase().includes("invalid") || err.status === 422;
      if (!isTotpErr) {
        console.warn("[MFA] Verification failed:", err);
      }
      setError(
        isTotpErr
          ? "Invalid or expired 6-digit code. Please wait for the next code in your Authenticator app and enter it. Tip: Ensure your device's date & time settings are set to 'Automatic'."
          : (err.message || "Invalid verification code. Please try again.")
      );
      lastSubmittedCodeRef.current = "";
      setOtp(["", "", "", "", "", ""]);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      verifyingRef.current = false;
      if (!verifiedSuccessRef.current) {
        setLoading(false);
      }
    }
  };

  // Auto-submit when all 6 digits are typed
  useEffect(() => {
    const fullCode = otp.join("").replace(/\D/g, "");
    if (
      fullCode.length === 6 &&
      (method === "otp" ? smsSent : Boolean(factorId)) &&
      !loading &&
      !verifyingRef.current &&
      !verifiedSuccessRef.current &&
      lastSubmittedCodeRef.current !== fullCode
    ) {
      void handleVerify();
    }
  }, [otp, factorId, loading, method, smsSent]);

  if (authLoading) {
    return (
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="relative z-10 min-h-[100dvh] flex items-center justify-center px-4 py-24">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="w-full max-w-md rounded-3xl border border-border/70 bg-card/90 p-6 sm:p-8 text-center shadow-xl backdrop-blur-md"
      >
        <img
          src="/assets/ama_avatar.webp"
          alt=""
          width={88}
          height={88}
          className="mx-auto h-[88px] w-[88px] rounded-full border-4 border-primary/60 bg-white object-cover object-top"
        />

        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          <Lock className="w-3.5 h-3.5" /> Your account is protected
        </p>

        <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-foreground">
          {method === "otp" ? "Admin SMS Verification" : "Enter your security code"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {method === "otp"
            ? `Verify with a 6-digit SMS code sent to your approved admin phone${adminOtpInfo?.masked_phone ? ` (${adminOtpInfo.masked_phone})` : ""}.`
            : "Open your authenticator app and type the 6-digit code for SwiftData."}
        </p>

        {/* Approved-Admin Method Switcher (2FA <-> Admin SMS OTP) */}
        {adminOtpInfo?.eligible && (
          <div className="mt-5 grid grid-cols-2 gap-1.5 rounded-2xl bg-muted/70 p-1">
            <button
              type="button"
              onClick={() => {
                setMethod("totp");
                setError("");
                setOtp(["", "", "", "", "", ""]);
              }}
              disabled={!factorId}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all disabled:opacity-40 ${
                method === "totp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              2FA App
            </button>
            <button
              type="button"
              onClick={() => {
                setMethod("otp");
                setError("");
                setOtp(["", "", "", "", "", ""]);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all ${
                method === "otp"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Admin SMS OTP
            </button>
          </div>
        )}

        {method === "otp" && !smsSent ? (
          <div className="mt-6 space-y-3">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-500/15 px-3 py-2.5 text-left text-sm font-medium text-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="button"
              disabled={sendingSms}
              onClick={() => void handleRequestAdminSmsOtp()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
            >
              {sendingSms ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending Admin OTP...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send 6-Digit SMS Code {adminOtpInfo?.masked_phone ? `to ${adminOtpInfo.masked_phone}` : ""}
                </>
              )}
            </button>
          </div>
        ) : (
          <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div className="flex justify-center gap-1.5 sm:gap-2.5">
            {otp.map((data, index) => (
              <input
                key={index}
                ref={(el) => (inputRefs.current[index] = el)}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${index + 1} of 6`}
                maxLength={6} // Allows pasting full length
                value={data}
                onPaste={(e) => handlePaste(e, index)}
                onChange={(e) => handleOtpChange(e.target, index)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                className={`h-14 w-11 sm:w-12 rounded-2xl border-2 bg-background text-center text-2xl font-black text-foreground outline-none transition-colors focus:border-primary ${
                  error ? "border-amber-500" : "border-border"
                }`}
              />
            ))}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="flex items-start gap-2 rounded-2xl bg-amber-500/15 px-3 py-2.5 text-left text-sm font-medium text-foreground"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>{error}</span>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading || otp.join("").length !== 6}
            className="group flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition active:scale-[0.98] disabled:bg-muted disabled:text-muted-foreground"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking your code...
              </>
            ) : (
              <>
                Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>
        )}

        {method === "otp" ? (
          <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span>Code expires in 5 minutes.</span>
            {smsSent && (
              <button
                type="button"
                disabled={sendingSms}
                onClick={() => void handleRequestAdminSmsOtp()}
                className="font-semibold text-primary hover:underline disabled:opacity-50"
              >
                {sendingSms ? "Sending..." : "Resend SMS"}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">Codes change every 30 seconds.</p>
        )}

        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login");
          }}
          className="mt-2 min-h-10 px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel and sign out
        </button>
      </motion.div>
    </main>
  );
};

export default VerifyMfa;
