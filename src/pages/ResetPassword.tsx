import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Zap } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { updatePassword } = useAuth();

  const loginRoute = "/login";

  useEffect(() => {
    let mounted = true;

    const prepareRecoverySession = async () => {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const recoveryTypeFromSearch = search.get("type");
      const tokenHash = search.get("token_hash");
      const code = search.get("code");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const type = hash.get("type");

      if (tokenHash && recoveryTypeFromSearch === "recovery") {
        const { error } = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });

        if (mounted) {
          setLinkValid(!error);
          setCheckingLink(false);
        }

        if (!error) {
          window.history.replaceState({}, "", window.location.pathname);
        }
        return;
      }

      if (code && recoveryTypeFromSearch === "recovery") {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (mounted) {
          setLinkValid(!error);
          setCheckingLink(false);
        }

        if (!error) {
          window.history.replaceState({}, "", window.location.pathname);
        }
        return;
      }

      if (accessToken && refreshToken && type === "recovery") {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (mounted) {
          setLinkValid(!error);
          setCheckingLink(false);
        }

        if (!error) {
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      setLinkValid(!!data.session);
      setCheckingLink(false);
    };

    prepareRecoverySession();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!linkValid) {
      toast({
        title: "Reset link expired",
        description: "Open the latest reset link from your email and try again.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({ title: "Password is too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Re-enter both fields and try again.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const { error } = await updatePassword(password);
    if (error) {
      toast({
        title: "Unable to reset password",
        description: "Open the reset link from your email again and retry.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    toast({ title: "Password updated", description: "You can now sign in with your new password." });
    navigate(loginRoute);
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-8 h-8 text-primary" />
            <span className="font-display text-2xl font-bold">QuickData GH</span>
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">Reset Password</h1>
          <p className="text-muted-foreground text-sm">Enter your new password below.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          {checkingLink ? (
            <div className="text-sm text-muted-foreground">Validating reset link...</div>
          ) : !linkValid ? (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              This reset link is invalid or expired. Request a new password reset link and try again.
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative mt-1">
                <Input
                  id="newPassword"
                  type={showPasswords ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                  className="bg-secondary pr-10"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="********"
                className="mt-1 bg-secondary"
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading || checkingLink || !linkValid}>
              {loading ? "Updating password..." : "Set New Password"}
            </Button>
          </form>

          <div className="mt-6 border-t border-border pt-3 text-center">
            <Link to={loginRoute} className="text-sm text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
