import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldAlert, Loader2, QrCode, RefreshCw, CheckCircle2, AlertTriangle, Trash2, Copy } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { QRCodeCanvas } from "qrcode.react";

const MfaSetupWidget = () => {
  const { user, isMfaEnabled, refreshMfaStatus } = useAuth();
  
  const [step, setStep] = useState<"idle" | "setup" | "active">("idle");
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  
  // Enrollment details
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [verificationCode, setVerificationCode] = useState("");
  
  // Current factor for unenrolling
  const [activeFactorId, setActiveFactorId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const verifyingRef = useRef(false);

  // Initial status sync
  useEffect(() => {
    const syncMfaFactors = async () => {
      if (!user?.id) return;
      setCheckingStatus(true);
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;

        const verified = data.all.find(f => f.status === "verified");
        if (verified) {
          setActiveFactorId(verified.id);
          setStep("active");
        } else {
          setStep("idle");
        }
      } catch (e) {
        console.error("[MFA Setup] List factors failed:", e);
      } finally {
        setCheckingStatus(false);
      }
    };

    void syncMfaFactors();
  }, [user?.id, isMfaEnabled]);

  const handleBeginEnrollment = async () => {
    console.log("[MFA] Beginning enrollment script execution...");
    setErrorMessage("");
    setLoading(true);
    
    try {
      if (!supabase?.auth?.mfa) {
        throw new Error("Supabase Multi-Factor Authentication SDK is missing from the build client.");
      }

      // Clean up any stale unverified TOTP factors so friendlyName never collides with 422
      const { data: existingFactors } = await supabase.auth.mfa.listFactors().catch(() => ({ data: null }));
      const unverifiedFactors = (existingFactors?.all || []).filter(f => f.status !== "verified");
      for (const uf of unverifiedFactors) {
        await supabase.auth.mfa.unenroll({ factorId: uf.id }).catch(() => null);
      }

      // Initiate TOTP factor creation in Supabase auth engine
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "SwiftData Ghana",
        friendlyName: `TOTP (${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
      });

      if (error) throw error;

      setFactorId(data.id);
      setQrUri(data.totp.uri);
      setSecret(data.totp.secret);
      setStep("setup");
      toast.success("Authenticator profile created! Scan the QR code.");
    } catch (e: any) {
      console.error("[MFA Setup Alert] Setup failure catch:", e);
      const rawMsg = e?.message || e?.toString() || "Unknown enrollment exception.";
      setErrorMessage(rawMsg);
      toast.error("Could not start 2FA setup", { description: rawMsg });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyingRef.current || loading) return;
    const cleanCode = verificationCode.replace(/\D/g, "");
    if (!factorId || cleanCode.length !== 6) {
      toast.error("Please enter the full 6-digit code.");
      return;
    }

    verifyingRef.current = true;
    setLoading(true);
    try {
      // 1. Request initial challenge to verify enrollment
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId
      });
      if (challengeError) throw challengeError;

      // 2. Submit the token to promote status from 'unverified' to 'verified'
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: cleanCode
      });

      if (verifyError) throw verifyError;

      toast.success("2FA Successfully Activated! 🛡️");
      setActiveFactorId(factorId);
      setStep("active");
      await refreshMfaStatus();
    } catch (e: any) {
      toast.error("Verification failed", { description: e.message || "Check your code and try again." });
    } finally {
      verifyingRef.current = false;
      setLoading(false);
      setVerificationCode("");
    }
  };

  const handleDisableMfa = async () => {
    if (!activeFactorId) return;
    
    const confirmed = window.confirm(
      "CRITICAL WARNING:\n\nDisabling Two-Factor Authentication will immediately lower your account protection level. Are you sure you want to remove this secure shield?"
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: activeFactorId
      });

      if (error) throw error;

      toast.success("2FA protection disabled successfully.");
      setActiveFactorId(null);
      setStep("idle");
      await refreshMfaStatus();
    } catch (e: any) {
      toast.error("Could not disable 2FA", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEnrollment = async () => {
    if (factorId) {
      // Clean up the unverified factor
      await supabase.auth.mfa.unenroll({ factorId });
    }
    setFactorId(null);
    setQrUri("");
    setSecret("");
    setVerificationCode("");
    setStep("idle");
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    toast.success("Secret setup key copied to clipboard!");
  };

  if (checkingStatus) {
    return (
      <div className="flex items-center justify-center py-12 border border-white/5 bg-card/50 rounded-3xl">
        <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        <span className="ml-3 text-muted-foreground text-xs font-bold tracking-wide uppercase">Checking Security Sync...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-8">
      
      {/* ── STEP 1: Idle / Unenrolled State ── */}
      {step === "idle" && (
        <Card className="border-none bg-card shadow-sm overflow-hidden relative group">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-indigo-400" />
              Authenticator App (2FA)
            </CardTitle>
            <CardDescription>
              Enforce a second layer of protection. Every login will require a time-based security code from your device.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/10 p-4 mb-5 flex items-start gap-3">
              <QrCode className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-relaxed uppercase tracking-wide font-medium">
                Compatible with Google Authenticator, Authy, Microsoft Authenticator, and iCloud Passwords.
              </p>
            </div>
            
            {errorMessage && (
              <div className="mb-5 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold rounded-xl flex items-center gap-3 animate-pulse">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div className="flex-1">
                  <p className="uppercase tracking-wider text-[10px] font-black text-red-300 mb-0.5">Backend Error Logs</p>
                  <p className="font-mono opacity-90 break-all leading-relaxed">{errorMessage}</p>
                </div>
              </div>
            )}

            <Button 
              type="button"
              onClick={handleBeginEnrollment}
              disabled={loading}
              className="h-12 px-8 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/10"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Creating Profile...</>
              ) : (
                <>🔒 Enable App Authenticator</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Enrollment Screen (QR Code Scanning) ── */}
      {step === "setup" && (
        <Card className="border-none bg-card ring-1 ring-indigo-500/20 shadow-xl overflow-hidden">
          <CardHeader className="bg-indigo-500/5 border-b border-indigo-500/10">
            <CardTitle className="text-lg font-bold flex items-center gap-2 text-indigo-400">
              <QrCode className="w-5 h-5" />
              Set Up Authenticator
            </CardTitle>
            <CardDescription>Follow the three quick steps to link your device.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-8">
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
              {/* Instructions & Secret */}
              <div className="md:col-span-7 space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-xs font-black shrink-0">1</div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Scan QR Code</h4>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Open your authenticator app, select "Add Account", and aim your camera at the screen.</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-xs font-black shrink-0">2</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-white">Or Enter Manually</h4>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">If you cannot scan, copy this secure setup key into your app instead:</p>
                      
                      <div className="flex gap-2 mt-3">
                        <code className="flex-1 bg-zinc-800/60 px-3 py-2.5 rounded-lg font-mono text-[11px] font-bold text-indigo-300 border border-white/5 break-all leading-tight">
                          {secret}
                        </code>
                        <Button type="button" onClick={copySecret} variant="secondary" size="icon" className="shrink-0 h-10 w-10 rounded-lg">
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-4 pt-2 border-t border-white/5">
                    <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-xs font-black shrink-0">3</div>
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-white">Confirm Launch</h4>
                      <p className="text-xs text-muted-foreground mt-1">Type the 6-digit time-sensitive code generated by your app to verify synchronization:</p>
                      
                      <form onSubmit={handleVerifyAndActivate} className="flex gap-3 mt-4 max-w-xs">
                        <Input 
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="e.g. 029182"
                          className="h-11 bg-secondary/50 border-white/5 font-bold text-center text-lg tracking-widest rounded-xl"
                          maxLength={6}
                          inputMode="numeric"
                          required
                        />
                        <Button 
                          type="submit"
                          disabled={loading || verificationCode.length !== 6}
                          className="h-11 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 shrink-0 px-5 shadow-md shadow-indigo-600/10"
                        >
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Activate"}
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>

              {/* QR Code Canvas */}
              <div className="md:col-span-5 flex flex-col items-center justify-center bg-zinc-900/40 border border-white/5 rounded-2xl p-6 text-center">
                <div className="bg-white p-3.5 rounded-xl shadow-2xl border border-white/10 relative overflow-hidden group">
                  <QRCodeCanvas 
                    value={qrUri} 
                    size={160} 
                    level="H"
                    imageSettings={{
                      src: "https://avatars.githubusercontent.com/u/106874272?s=200&v=4", // Safe generic icon overlay
                      x: undefined,
                      y: undefined,
                      height: 28,
                      width: 28,
                      excavate: true,
                    }}
                  />
                </div>
                <p className="text-[10px] text-indigo-300/75 tracking-widest uppercase font-black mt-4">Scan with Phone</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-6 border-t border-white/5">
              <p className="text-[10px] text-muted-foreground italic flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin duration-3000" /> Encryption sync live.
              </p>
              <Button 
                type="button"
                onClick={handleCancelEnrollment} 
                variant="ghost" 
                className="text-muted-foreground hover:text-red-400 hover:bg-red-400/5 text-xs font-bold rounded-xl"
              >
                Cancel Setup
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Active / Enrolled State ── */}
      {step === "active" && (
        <Card className="border border-emerald-500/20 bg-emerald-500/5 shadow-md overflow-hidden relative">
          {/* High security mesh background */}
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />
          
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-start sm:items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 animate-pulse shadow-emerald-500/5 shadow-lg">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-emerald-400 flex items-center gap-1">
                      2FA Security Fully Active
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
                    Your wallet and transactions are protected by absolute industry-grade encryption. Your device is successfully synchronized.
                  </p>
                </div>
              </div>
              
              <Button 
                type="button"
                onClick={handleDisableMfa}
                disabled={loading}
                variant="outline" 
                className="h-11 px-5 font-bold rounded-xl border-red-500/20 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 hover:text-red-300 shrink-0 gap-2 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Disable Protection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
};

export default MfaSetupWidget;
