import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { callPasswordResetApi } from "@/lib/password-reset-api";

const VerifyOtp = () => {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const role = searchParams.get("role") === "agent" ? "agent" : "user";
  const email = useMemo(() => (searchParams.get("email") || "").trim().toLowerCase(), [searchParams]);
  const loginRoute = role === "agent" ? "/agent/login" : "/login";
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const code = otp.trim();
    if (!email) {
      toast({ title: "Missing email", description: "Start from forgot password page.", variant: "destructive" });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "Invalid code", description: "Enter a 6-digit OTP.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const result = await callPasswordResetApi<{ data?: { resetToken?: string } }>("/api/verify-otp", {
      email,
      otp: code,
    });
    setLoading(false);

    if (!result.ok) {
      toast({ title: "Verification failed", description: result.message, variant: "destructive" });
      return;
    }

    const resetToken = (result.data as any)?.data?.resetToken as string | undefined;
    if (!resetToken) {
      toast({ title: "Verification failed", description: "Reset token missing.", variant: "destructive" });
      return;
    }

    sessionStorage.setItem("password_reset_email", email);
    sessionStorage.setItem("password_reset_token", resetToken);
    toast({ title: "Code verified", description: "Set your new password." });
    navigate(`/reset-password?email=${encodeURIComponent(email)}&role=${role}`);
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
          <h1 className="font-display text-2xl font-bold mb-2">Verify Code</h1>
          <p className="text-muted-foreground text-sm">
            Enter the 6-digit OTP sent to <span className="font-medium">{email || "your email"}</span>.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="otp">OTP Code</Label>
              <Input
                id="otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                maxLength={6}
                className="mt-1 bg-secondary tracking-[0.25em] text-center"
                required
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Verifying..." : "Verify OTP"}
            </Button>
          </form>

          <div className="mt-6 border-t border-border pt-3 text-center space-y-2">
            <Link to={`/forgot-password?role=${role}&email=${encodeURIComponent(email)}`} className="text-sm text-primary hover:underline block">
              Resend code
            </Link>
            <Link to={loginRoute} className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyOtp;

