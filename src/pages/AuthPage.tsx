import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Eye, EyeOff, Loader2, Fingerprint } from "lucide-react";
import { useWebAuthn } from "@/hooks/useWebAuthn";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { 
      duration: 0.5, 
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 30 } }
};

const AuthPage = () => {
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { signUp, signIn, signInWithOAuth } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get("ref") || "";
  const { authenticate, register, isSupported } = useWebAuthn();
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [enableBiometricsOnSignUp, setEnableBiometricsOnSignUp] = useState(false);

  const getPostLoginRoute = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return "/dashboard";

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (adminRole?.role === "admin") return "/admin";

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_sub_agent, sub_agent_approved, is_agent, agent_approved, onboarding_complete")
      .eq("user_id", user.id)
      .maybeSingle();

    // Sub-agent pending users must always continue activation payment.
    if (profile?.is_sub_agent && !profile?.sub_agent_approved) return "/sub-agent/pending";
    if (profile?.is_sub_agent && profile?.sub_agent_approved) return "/dashboard";

    if (profile?.is_agent && !profile?.agent_approved) return "/agent/pending";
    if (profile?.is_agent && profile?.agent_approved) return "/dashboard";

    return "/dashboard";
  };

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFullName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      if (!fullName.trim()) {
        toast({ title: "Please enter your full name", variant: "destructive" });
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        toast({ title: "Passwords do not match", variant: "destructive" });
        setLoading(false);
        return;
      }

      const { data, error } = await signUp(email, password, fullName, {
        referralCode,
        isAgent: isAgentRoute,
      });

      if (error) {
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      } else {
        if (data?.session) {
          if (enableBiometricsOnSignUp) {
            try {
              toast({ title: "Sign Up Success!", description: "Please scan your fingerprint now to enable Biometric Login." });
              await register("Primary Device");
            } catch (regErr) {
              console.error("Auto biometric setup failed:", regErr);
              toast({ title: "Biometric Registration Skipped", description: "You can still enable it later from settings.", variant: "destructive" });
            }
          }
          toast({ title: "Welcome!", description: "Your account is ready." });
          const route = await getPostLoginRoute();
          navigate(route);
        } else {
          toast({ 
            title: "Verification Email Sent", 
            description: "Please check your inbox (and spam folder) for a verification link to confirm your email before signing in.", 
            variant: "default" 
          });
          setPassword("");
          setConfirmPassword("");
          setIsSignUp(false);
        }
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
      } else {
        const route = await getPostLoginRoute();
        navigate(route);
      }
    }
    setLoading(false);
  };

  const handleForgotPassword = () => {
    const normalizedEmail = email.trim().toLowerCase();
    const prefill = normalizedEmail ? `&email=${encodeURIComponent(normalizedEmail)}` : "";
    navigate(`/forgot-password?role=user${prefill}`);
  };

  const isAgentRoute = window.location.pathname.includes("/agent/login");

  const handleOAuthSignIn = async (provider: "google") => {
    setOauthLoading(provider);
    const role = isAgentRoute ? "agent" : "user";
    const { error } = await signInWithOAuth(provider, `/auth/callback?role=${role}`);
    if (error) {
      toast({ title: "Social sign in failed", description: error.message, variant: "destructive" });
      setOauthLoading(null);
    }
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    try {
      // 1. Call with current input email, or let simplewebauthn trigger browser lookup without it
      const loginEmail = email.trim() || undefined;
      
      const success = await authenticate(loginEmail);
      if (success) {
        toast({ title: "Success!", description: "Successfully signed in with biometrics." });
        const route = await getPostLoginRoute();
        navigate(route);
      }
    } catch (err: any) {
      console.error("Biometric Login Error:", err);
      
      // Robust recommendations for failures
      let recommendation = "\n\n💡 Recommendation: Ensure you have registered your biometrics in 'Account Settings' on this device first.";
      if (!email.trim()) {
        recommendation += " Or try typing your email to perform a targeted lookup.";
      }
      
      toast({ 
        title: "Authentication Hint", 
        description: (err.message || "Could not verify identity.") + recommendation, 
        variant: "destructive" 
      });
    } finally {
      setBiometricLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-20 pb-16 px-4 flex items-center justify-center relative overflow-hidden">
      
      {/* Ambient Background Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <motion.div 
        className="w-full max-w-md relative z-10"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        {/* Header */}
        <motion.div variants={itemVariants} className="text-center mb-6">
          <div className="flex items-center justify-center mb-4">
            <motion.div 
              whileHover={{ scale: 1.05, rotate: 5 }}
              className="w-16 h-16 rounded-full bg-[#162316] flex items-center justify-center shadow-xl border border-white/5"
            >
              <span className="text-white font-black text-[11px] text-center leading-tight tracking-wider">SWIFT<br/>DATA</span>
            </motion.div>
          </div>
        </motion.div>

        <motion.p variants={itemVariants} className="text-center text-muted-foreground text-sm mb-4 font-medium">
          {isSignUp
            ? "Create your account to access your dashboard"
            : "Sign in to continue to your dashboard"}
        </motion.p>

        {/* Form Card */}
        <motion.div 
          variants={itemVariants}
          className="bg-card border border-border shadow-2xl rounded-3xl p-6 sm:p-8 relative overflow-hidden backdrop-blur-md"
          layout
        >
          {/* Enhanced Tab Switcher using Layout Animation */}
          <div className="flex p-1.5 bg-secondary/80 rounded-2xl mb-8 border border-border/50 relative">
            <button
              onClick={() => { setIsSignUp(false); resetForm(); }}
              className={`flex-1 relative z-10 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-colors duration-300 ${
                !isSignUp ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              Sign In
              {!isSignUp && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-card rounded-xl shadow-md ring-1 ring-border z-[-1]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
            <button
              onClick={() => { setIsSignUp(true); resetForm(); }}
              className={`flex-1 relative z-10 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-colors duration-300 ${
                isSignUp ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              Sign Up
              {isSignUp && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-primary rounded-xl shadow-[0_4px_20px_rgba(251,191,36,0.3)] z-[-1]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5 relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={isSignUp ? "signup" : "signin"}
                initial={{ opacity: 0, x: isSignUp ? 20 : -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: isSignUp ? -20 : 20 }}
                transition={{ duration: 0.2 }}
                className="space-y-3.5"
              >
                {isSignUp && (
                  <motion.div layout>
                    <Label htmlFor="fullName" className="text-xs font-bold">Full Name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Kwame Asante"
                      className="mt-1 bg-secondary h-11 border-transparent focus-visible:border-primary/30 focus-visible:ring-primary/10 rounded-xl transition-all"
                      required
                    />
                  </motion.div>
                )}

                <motion.div layout>
                  <Label htmlFor="email" className="text-xs font-bold">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="kwame@example.com"
                    className="mt-1 bg-secondary h-11 border-transparent focus-visible:border-primary/30 focus-visible:ring-primary/10 rounded-xl transition-all"
                    required
                  />
                </motion.div>

                <motion.div layout>
                  <Label htmlFor="password" className="text-xs font-bold">Password</Label>
                  <div className="relative mt-1">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="bg-secondary pr-10 h-11 border-transparent focus-visible:border-primary/30 focus-visible:ring-primary/10 rounded-xl transition-all"
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {!isSignUp && (
                    <motion.button
                      layout
                      type="button"
                      onClick={handleForgotPassword}
                      className="mt-1.5 text-xs text-primary font-semibold hover:underline"
                    >
                      Forgot password?
                    </motion.button>
                  )}
                </motion.div>

                {isSignUp && (
                  <motion.div layout>
                    <Label htmlFor="confirmPassword" className="text-xs font-bold">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="mt-1 bg-secondary h-11 border-transparent focus-visible:border-primary/30 focus-visible:ring-primary/10 rounded-xl transition-all"
                      required
                      minLength={6}
                    />
                  </motion.div>
                )}

                {isSignUp && isSupported && (
                  <motion.div layout className="flex items-start gap-2 bg-primary/5 p-3 rounded-xl border border-primary/10 mt-2">
                    <Checkbox 
                      id="enableBiometrics" 
                      checked={enableBiometricsOnSignUp}
                      onCheckedChange={(c) => setEnableBiometricsOnSignUp(!!c)}
                      className="mt-0.5 border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <div className="grid gap-1.5 leading-none">
                      <label
                        htmlFor="enableBiometrics"
                        className="text-xs font-bold flex items-center gap-1.5 cursor-pointer text-foreground"
                      >
                        <Fingerprint className="w-3.5 h-3.5 text-primary" />
                        Enable Biometric Sign-in
                      </label>
                      <p className="text-[10px] text-muted-foreground">
                        Sign in faster using your fingerprint or face next time.
                      </p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>

            <motion.div layout className="pt-2 flex flex-col gap-2.5">
              <Button 
                type="submit" 
                className="w-full h-12 text-sm font-black shadow-lg shadow-primary/20 rounded-xl transition-all hover:shadow-primary/30 active:scale-[0.98]" 
                disabled={loading || !!oauthLoading || biometricLoading}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {isSignUp ? "Create Account" : "Sign In"}
                    <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>

              {!isSignUp && isSupported && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBiometricLogin}
                  disabled={loading || !!oauthLoading || biometricLoading}
                  className="w-full h-12 border border-primary/20 bg-background/50 hover:bg-primary/5 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {biometricLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  ) : (
                    <>
                      <Fingerprint className="w-5 h-5 text-primary" />
                      Sign In with Biometrics
                    </>
                  )}
                </Button>
              )}
            </motion.div>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-3 text-muted-foreground font-semibold tracking-wider text-[10px]">
                Or continue with
              </span>
            </div>
          </div>

          <motion.div layout>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuthSignIn("google")}
              disabled={loading || !!oauthLoading || biometricLoading}
              className="w-full h-12 border border-border bg-background/40 backdrop-blur-sm hover:bg-secondary/80 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-3 shadow-sm group"
            >
              {oauthLoading === "google" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span className="tracking-tight">Continue with Google</span>
                </>
              )}
            </Button>
          </motion.div>

          <div className="mt-3 text-center border-t border-border pt-3">
            <Link to="/agent-program" className="text-xs font-black text-primary hover:underline tracking-tight">
              Want to become an agent? Learn more →
            </Link>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
