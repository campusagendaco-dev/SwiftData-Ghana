import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AuthPage = () => {
  const [isSignUp, setIsSignUp] = useState(false);
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

      const { error } = await signUp(email, password, fullName);
      if (error) {
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      } else {
        const { error: signInError } = await signIn(email, password);
        if (!signInError) {
          toast({ title: "Welcome!", description: "Your account is ready." });
          navigate("/dashboard");
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

  return (
    <div className="min-h-screen pt-20 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-[#162316] flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-[11px] text-center leading-tight">SWIFT<br/>DATA</span>
            </div>
          </div>
        </div>

        <p className="text-center text-muted-foreground text-sm mb-4">
          {isSignUp
            ? "Create your account to access your dashboard"
            : "Sign in to continue to your dashboard"}
        </p>

        {/* Form Card */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          <h2 className="font-display text-lg font-bold text-center mb-5">
            {isSignUp ? "Create Account" : "Sign In"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isSignUp && (
              <div>
                <Label htmlFor="fullName" className="text-xs">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Kwame Asante"
                  className="mt-1 bg-secondary h-11"
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kwame@example.com"
                className="mt-1 bg-secondary h-11"
                required
              />
            </div>

            <div>
              <Label htmlFor="password" className="text-xs">Password</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-secondary pr-10 h-11"
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
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="mt-1.5 text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>

            {isSignUp && (
              <div>
                <Label htmlFor="confirmPassword" className="text-xs">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 bg-secondary h-11"
                  required
                  minLength={6}
                />
              </div>
            )}

            <Button type="submit" className="w-full h-11 text-sm font-semibold" disabled={loading || !!oauthLoading}>
              {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </form>

          {/* Divider */}
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Google */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-11 relative overflow-hidden transition-all hover:bg-white/5 active:scale-[0.98] border-white/10"
            disabled={!!oauthLoading || loading}
            onClick={() => handleOAuthSignIn("google")}
          >
            {oauthLoading === "google" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <div className="flex items-center justify-center gap-3">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="font-bold">Continue with Google</span>
              </div>
            )}
          </Button>

          {/* Toggle Sign Up / Sign In */}
          <div className="mt-5 text-center">
            <button
              onClick={() => { setIsSignUp(!isSignUp); resetForm(); }}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>

          <div className="mt-3 text-center border-t border-border pt-3">
            <Link to="/agent-program" className="text-xs text-primary hover:underline">
              Want to become an agent? Learn more →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
