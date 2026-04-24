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
