import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const VerifyMfa = () => {
  const { user, loading: authLoading, refreshMfaStatus, isMfaChallenged } = useAuth();
  const navigate = useNavigate();
  
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch active MFA TOTP factor on load
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }

    const initializeFactor = async () => {
      try {
        // 1. Retrieve list of enrolled factors
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;

        const verifiedFactors = factorsData.all.filter(f => f.status === "verified");
        if (verifiedFactors.length === 0) {
          // Intelligent Self-Healing Recovery Loop Breaker!
          console.warn("[MFA Recovery] No active factors found on server. Clearing stale session.");
          await supabase.auth.signOut({ scope: "local" });
          
          toast.success("Security settings reset! Please enter your password one more time to log in.", { duration: 6000 });
          navigate("/login");
          return;
        }

        const totpFactor = verifiedFactors[0];
        setFactorId(totpFactor.id);
      } catch (e: any) {
        console.error("[MFA Init] Factor initialization error:", e);
        setError("Could not initialize secure connection. Please try again.");
      }
    };

    initializeFactor();
  }, [user, navigate]);

  // Automatically refocus the first box on load
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleOtpChange = (element: HTMLInputElement, index: number) => {
    const value = element.value.replace(/\D/g, ""); // Allow digits only
    if (!value) {
      const nextOtp = [...otp];
      nextOtp[index] = "";
      setOtp(nextOtp);
      return;
    }

    const nextOtp = [...otp];
    // Handle pasting full 6 digits
    if (value.length > 1) {
      const pastedValues = value.slice(0, 6).split("");
      pastedValues.forEach((v, i) => {
        if (index + i < 6) nextOtp[index + i] = v;
      });
      setOtp(nextOtp);
      // Focus next empty or last index
      const nextFocus = Math.min(index + pastedValues.length, 5);
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
    const fullCode = otp.join("");
    if (fullCode.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    if (!factorId) {
      setError("Authentication session not ready. Please refresh.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 1. Create the challenge immediately before verification
      // This prevents "Challenge and verify IP addresses mismatch" by executing both in the exact same thread
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      });
      
      if (challengeError) {
        throw challengeError;
      }

      // 2. Immediately verify the challenge
      const { data, error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: fullCode,
      });

      if (verifyError) {
        throw verifyError;
      }

      toast.success("Secure login verified! Welcome back.");
      await refreshMfaStatus();
      navigate("/dashboard");
    } catch (err: any) {
      console.error("[MFA] Verification failed:", err);
      const isTotpErr = (err.message || "").toLowerCase().includes("totp") || (err.message || "").toLowerCase().includes("invalid") || err.status === 422;
      setError(
        isTotpErr
          ? "Invalid or expired 6-digit code. Please check your Authenticator app for the latest code. Tip: Ensure your device's date & time settings are set to 'Automatic'."
          : (err.message || "Invalid verification code. Please try again.")
      );
      setOtp(["", "", "", "", "", ""]);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when all 6 digits are typed
  useEffect(() => {
    if (otp.join("").length === 6 && factorId) {
      handleVerify();
    }
  }, [otp, factorId]);

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

        <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-foreground">Enter your security code</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Open your authenticator app and type the 6-digit code for SwiftData.
        </p>

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

        <p className="mt-4 text-xs text-muted-foreground">Codes change every 30 seconds.</p>

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
