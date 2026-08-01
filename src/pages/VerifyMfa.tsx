import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const VerifyMfa = () => {
  const { user, refreshMfaStatus, isMfaChallenged } = useAuth();
  const navigate = useNavigate();
  
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch active MFA TOTP factor on load
  useEffect(() => {
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
      const isTotpErr = (err.message || "").toLowerCase().includes("totp") || (err.message || "").toLowerCase().includes("invalid");
      setError(
        isTotpErr
          ? "Invalid or expired 6-digit code. Please check your Authenticator app and ensure your phone clock is set to Automatic time."
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-[#09090b]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-zinc-950 to-zinc-950 -z-10" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md relative"
      >
        {/* Hologram safe glow effect behind card */}
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-violet-600 rounded-3xl blur opacity-15 pointer-events-none" />
        
        <div className="relative bg-zinc-900/80 border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-xl flex flex-col items-center text-center overflow-hidden">
          
          {/* Header Icon */}
          <div className="relative w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 group">
            <Lock className="w-8 h-8 text-indigo-400 group-hover:scale-110 transition-transform duration-300" />
            <div className="absolute inset-0 rounded-2xl bg-indigo-500/20 blur-md animate-pulse" />
          </div>

          <h1 className="text-2xl font-black text-white tracking-tight">Two-Factor Authentication</h1>
          <p className="text-zinc-400 text-sm mt-2 max-w-xs mx-auto leading-relaxed">
            Open your authenticator app and enter the 6-digit security code to unlock your account.
          </p>

          <form onSubmit={handleVerify} className="w-full mt-8 space-y-6">
            {/* OTP Code Inputs Container */}
            <div className="flex justify-center gap-2 sm:gap-3">
              {otp.map((data, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={6} // Allows pasting full length
                  value={data}
                  onChange={(e) => handleOtpChange(e.target, index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className={`w-12 h-14 text-center text-2xl font-black border rounded-xl bg-zinc-800/50 text-white focus:bg-zinc-800 focus:border-indigo-500 outline-none transition-all duration-200 focus:ring-4 focus:ring-indigo-500/20 sm:w-14 sm:h-16 ${
                    error ? "border-red-500/50 ring-2 ring-red-500/10" : "border-white/5"
                  }`}
                />
              ))}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold px-4 py-3 rounded-xl flex items-center gap-2 text-left"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || otp.join("").length !== 6}
                className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 text-sm font-black shadow-xl shadow-indigo-600/10 transition-all hover:shadow-indigo-600/20 active:scale-[0.98] flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying Security...
                  </>
                ) : (
                  <>
                    Authorize Login <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Secondary Actions */}
          <div className="mt-8 pt-6 border-t border-white/5 w-full">
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/login");
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-bold"
            >
              Cancel & Sign Out
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default VerifyMfa;
