import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callPasswordResetApi } from "@/lib/password-reset-api";

const isStrongPassword = (value: string) =>
  value.length >= 8 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [searchParams] = useSearchParams();
  const role = searchParams.get("role") === "agent" ? "agent" : "user";
  const emailFromQuery = (searchParams.get("email") || "").trim().toLowerCase();
  const emailFromSession = (sessionStorage.getItem("password_reset_email") || "").trim().toLowerCase();
  const email = useMemo(() => emailFromQuery || emailFromSession, [emailFromQuery, emailFromSession]);
  const resetToken = sessionStorage.getItem("password_reset_token") || "";

  const navigate = useNavigate();
  const { toast } = useToast();
  const loginRoute = role === "agent" ? "/agent/login" : "/login";
  const hasSession = Boolean(email && resetToken);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!hasSession) {
      toast({ title: "Session expired", description: "Verify OTP again to continue.", variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    if (!isStrongPassword(password)) {
      toast({
        title: "Weak password",
        description: "Use at least 8 chars with uppercase, lowercase, number, and special character.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const result = await callPasswordResetApi("/api/reset-password", {
      email,
      resetToken,
      newPassword: password,
      confirmPassword,
    });
    setLoading(false);

    if (!result.ok) {
      toast({ title: "Reset failed", description: result.message, variant: "destructive" });
      return;
    }

    sessionStorage.removeItem("password_reset_email");
    sessionStorage.removeItem("password_reset_token");
    toast({ title: "Password updated", description: "You can now sign in with your new password." });
    navigate(loginRoute, { replace: true });
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-[#162316] flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-[11px] text-center leading-tight">SWIFT<br/>DATA</span>
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold mb-2">Reset Password</h1>
          <p className="text-muted-foreground text-sm">Enter your new password and confirm it.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          {!hasSession && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Reset session is missing or expired. Verify OTP again.
            </div>
          )}

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
                  minLength={8}
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
                minLength={8}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading || !hasSession}>
              {loading ? "Updating password..." : "Set New Password"}
            </Button>
          </form>

          <div className="mt-6 border-t border-border pt-3 text-center space-y-2">
            {!hasSession && (
              <Link to={`/verify-otp?email=${encodeURIComponent(email)}&role=${role}`} className="text-sm text-primary hover:underline block">
                Go to OTP verification
              </Link>
            )}
            <Link to={loginRoute} className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;

