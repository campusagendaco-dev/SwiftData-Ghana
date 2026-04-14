import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { callPasswordResetApi } from "@/lib/password-reset-api";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const role = searchParams.get("role") === "agent" ? "agent" : "user";
  const loginRoute = role === "agent" ? "/agent/login" : "/login";
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast({ title: "Email is required", variant: "destructive" });
      return;
    }

    setLoading(true);
    const result = await callPasswordResetApi("/api/v1/auth/forgot-password", {
      email: normalizedEmail,
    });
    setLoading(false);

    if (!result.ok) {
      toast({ title: "Could not send code", description: result.message, variant: "destructive" });
      return;
    }

    toast({ title: "OTP sent", description: "Check your email for the verification code." });
    navigate(`/verify-otp?email=${encodeURIComponent(normalizedEmail)}&role=${role}`);
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
          <h1 className="font-display text-2xl font-bold mb-2">Forgot Password</h1>
          <p className="text-muted-foreground text-sm">Enter your email and we will send a 6-digit OTP code.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 bg-secondary"
                required
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? "Sending code..." : "Send OTP"}
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

export default ForgotPassword;
