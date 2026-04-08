import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AuthUser = () => {
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
        toast({ title: "Passwords do not match", description: "Please re-enter both passwords.", variant: "destructive" });
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, fullName);
      if (error) {
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      } else {
        const { error: signInError } = await signIn(email, password);
        if (!signInError) {
          toast({ title: "Welcome!", description: "Your account is ready. You can now buy data." });
          navigate("/buy-data");
        }
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: "Sign in failed", description: error.message, variant: "destructive" });
      } else {
        navigate("/buy-data");
      }
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const prefill = normalizedEmail ? `&email=${encodeURIComponent(normalizedEmail)}` : "";
    navigate(`/forgot-password?role=user${prefill}`);
  };

  const handleOAuthSignIn = async (provider: "google") => {
    setOauthLoading(provider);
    const { error } = await signInWithOAuth(provider, "/auth/callback?role=user");
    if (error) {
      toast({ title: "Social sign in failed", description: error.message, variant: "destructive" });
      setOauthLoading(null);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-8 h-8 text-primary" />
            <span className="font-display text-2xl font-bold">DataHive Ghana</span>
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">
            {isSignUp ? "Sign Up" : "Sign In"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isSignUp
              ? "Register with your email to start buying affordable data bundles"
              : "Sign in with your email to buy data quickly"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Kwame Asante"
                  className="mt-1 bg-secondary"
                  required
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kwame@example.com"
                className="mt-1 bg-secondary"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                  className="bg-secondary pr-10"
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
                  className="mt-2 text-xs text-primary hover:underline disabled:opacity-70"
                >
                  Forgot password?
                </button>
              )}
            </div>
            {isSignUp && (
              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="********"
                  className="mt-1 bg-secondary"
                  required
                  minLength={6}
                />
              </div>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading || !!oauthLoading}>
              {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!!oauthLoading || loading}
              onClick={() => handleOAuthSignIn("google")}
            >
              {oauthLoading === "google" ? "Connecting Google..." : "Continue with Google"}
            </Button>
          </div>

          <div className="mt-6 text-center space-y-3">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isSignUp ? "Already have an account? Sign in with email" : "Don't have an account? Sign up with email"}
            </button>
            <div className="border-t border-border pt-3">
              <Link to="/agent-program" className="text-sm text-primary hover:underline">
                Want to become a reseller? Click here
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthUser;
