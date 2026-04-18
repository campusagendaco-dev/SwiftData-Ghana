import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { Loader2, CreditCard, Clock, Zap } from "lucide-react";

const SubAgentPending = () => {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activationFee, setActivationFee] = useState(0);
  const [parentId, setParentId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  const verifyHeaders = () => {
    const anonKey = (supabase as any)?.supabaseKey as string | undefined;
    return anonKey ? { Authorization: `Bearer ${anonKey}` } : undefined;
  };

  // Load fees + auto-verify on return from Paystack
  useEffect(() => {
    const load = async () => {
      if (!profile?.parent_agent_id) { setLoadingData(false); return; }
      setParentId(profile.parent_agent_id);

      const { data: parentRes } = await supabase
        .from("profiles")
        .select("sub_agent_activation_markup")
        .eq("user_id", profile.parent_agent_id)
        .maybeSingle();

      const configuredFee = Number(parentRes?.sub_agent_activation_markup || 0);
      setActivationFee(Number.isFinite(configuredFee) && configuredFee > 0 ? configuredFee : 0);
      setLoadingData(false);
    };
    load();
  }, [profile]);

  // Auto-verify when returning from Paystack
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (!reference) return;

    setVerifying(true);
    supabase.functions.invoke("verify-payment", { body: { reference }, headers: verifyHeaders() }).then(async (res) => {
      if (res.data?.status === "fulfilled") {
        toast({ title: "Activation successful!", description: "Welcome to the team!" });
        await refreshProfile();
        navigate("/dashboard", { replace: true });
      } else {
        toast({ title: "Verifying payment...", description: "Please wait while we confirm your payment." });
        await refreshProfile();
      }
      window.history.replaceState({}, "", window.location.pathname);
      setVerifying(false);
    }).catch(() => {
      window.history.replaceState({}, "", window.location.pathname);
      setVerifying(false);
    });
  }, [refreshProfile, navigate, toast]);

  const totalFee = parseFloat(activationFee.toFixed(2));

  const handlePay = async () => {
    if (!user || !profile) return;
    if (!Number.isFinite(totalFee) || totalFee < 1) {
      toast({ title: "Activation fee not set", description: "This agent has not configured a valid sub-agent activation fee yet.", variant: "destructive" });
      return;
    }
    setPaying(true);

    const orderId = crypto.randomUUID();
    const agentProfitShare = parseFloat((totalFee * 0.5).toFixed(2));
    const swiftDataShare = parseFloat((totalFee - agentProfitShare).toFixed(2));

    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: profile.email || `${user.id}@subagent.swiftdata.gh`,
        amount: totalFee,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/sub-agent/pending?reference=${orderId}`,
        metadata: {
          order_id: orderId,
          order_type: "sub_agent_activation",
          sub_agent_id: user.id,
          agent_id: parentId || user.id,
          parent_agent_id: parentId,
          activation_fee: totalFee,
          paystack_fee: 0,
          agent_profit: agentProfitShare,
          swiftdata_share: swiftDataShare,
        },
      },
    });

    if (paymentError || !paymentData?.authorization_url) {
      toast({ title: "Payment failed", description: paymentData?.error || "Could not initialize payment.", variant: "destructive" });
      setPaying(false);
      return;
    }

    window.location.href = paymentData.authorization_url;
  };

  const handleCheckStatus = async () => {
    setVerifying(true);
    await refreshProfile();
    setVerifying(false);
    if (profile?.sub_agent_approved) {
      navigate("/dashboard", { replace: true });
    } else {
      toast({ title: "Not yet activated", description: "Payment may still be processing. Try again shortly." });
    }
  };

  if (loadingData || verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        {verifying ? "Verifying payment..." : "Loading..."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="SwiftData" className="w-16 h-16 mb-3" />
          <h1 className="font-display text-2xl font-black">Activate Your Account</h1>
          <p className="text-muted-foreground text-sm text-center mt-1">
            Complete your one-time activation payment to access your sub agent dashboard.
          </p>
        </div>

        {/* Status card */}
        <div className="rounded-xl border border-border bg-card p-5 mb-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-400/15 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-sm">Pending Activation</p>
              <p className="text-xs text-muted-foreground">Payment required to activate your account</p>
            </div>
          </div>

          <div className="space-y-1.5 text-sm border-t border-border pt-4">
            <div className="flex justify-between text-muted-foreground">
              <span>Activation fee</span><span>GH₵ {totalFee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Agent share (50%)</span><span>GH₵ {(totalFee * 0.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>SwiftData share (50%)</span><span>GH₵ {(totalFee * 0.5).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-foreground border-t border-border pt-1.5 mt-1.5">
              <span>Total to pay</span><span>GH₵ {totalFee.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handlePay}
            disabled={paying}
            className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {paying ? "Redirecting to Paystack..." : `Pay GH₵ ${totalFee.toFixed(2)} to Activate`}
          </button>

          <button
            onClick={handleCheckStatus}
            disabled={verifying}
            className="w-full border border-border text-foreground hover:bg-accent py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Already paid? Check Status
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-5">
          Need help?{" "}
          <a href="/" className="text-amber-600 hover:underline">Go back to home</a>
        </p>
      </div>
    </div>
  );
};

export default SubAgentPending;
