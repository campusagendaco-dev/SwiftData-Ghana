import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { Loader2, CreditCard, Clock, Zap, ArrowLeft } from "lucide-react";

const SubAgentPending = () => {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activationFee, setActivationFee] = useState(0);
  const [parentId, setParentId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

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
    invokePublicFunctionAsUser("verify-payment", { body: { reference } }).then(async (res) => {
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

    const { data: paymentData, error: paymentError } = await invokePublicFunction("initialize-payment", {
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
      <div className="min-h-screen flex items-center justify-center bg-[#030305]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-400/20 border-t-emerald-400 rounded-full animate-spin" />
          <p className="text-white/40 text-sm font-bold tracking-widest uppercase">{verifying ? "Confirming Payment..." : "Loading Session..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030305] flex flex-col items-center justify-center px-4 selection:bg-amber-400/30">
      
      {/* Mesh Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-amber-400/5 rounded-full blur-[140px]" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/3 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] space-y-10 animate-in fade-in zoom-in-95 duration-700">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative">
            <div className="absolute -inset-4 bg-amber-400/10 rounded-full blur-2xl animate-pulse" />
            <img src="/logo.png" alt="SwiftData" className="relative w-20 h-20 shadow-2xl rounded-3xl" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight text-white">Activate Account</h1>
            <p className="text-white/40 text-sm max-w-[280px] mx-auto">
              Pay your one-time activation fee to unlock your reseller dashboard.
            </p>
          </div>
        </div>

        {/* Status Card / Receipt */}
        <div className="relative rounded-[2.5rem] border border-white/10 bg-[#08080A]/80 backdrop-blur-3xl overflow-hidden shadow-3xl">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
          
          <div className="p-8 space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                <Clock className="w-7 h-7 text-amber-400 animate-pulse" />
              </div>
              <div className="space-y-0.5">
                <p className="text-white font-black text-lg">Awaiting Payment</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-amber-400 text-[10px] font-black uppercase tracking-widest">Action Required</span>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/5">
              <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest text-white/30">
                <span>Description</span>
                <span>Amount</span>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: "Activation Base", price: (totalFee * 0.5) },
                  { label: "Platform Access", price: (totalFee * 0.5) },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span className="text-white/50">{item.label}</span>
                    <span className="text-white/80 font-mono font-medium">₵{item.price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              
              <div className="pt-6 border-t border-white/5 flex justify-between items-end">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Total Due</p>
                  <p className="text-sm font-bold text-amber-400/60 tracking-tight italic">Incl. all taxes</p>
                </div>
                <p className="text-4xl font-black text-white tracking-tighter">₵{totalFee.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handlePay}
            disabled={paying}
            className="group w-full relative overflow-hidden bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-black font-black py-4.5 rounded-2xl text-sm transition-all shadow-[0_10px_40px_rgba(245,158,11,0.2)] hover:scale-[1.02] active:scale-[0.98]"
          >
            <div className="absolute inset-0 bg-white/30 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 pointer-events-none" />
            <div className="relative flex items-center justify-center gap-2">
              {paying ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {paying ? "Opening Secure Checkout..." : `Pay ₵${totalFee.toFixed(2)} Now`}
            </div>
          </button>

          <button
            onClick={handleCheckStatus}
            disabled={verifying}
            className="w-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-white/60 hover:text-white py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Refresh Status
          </button>
        </div>

        {/* Footer */}
        <div className="text-center space-y-4">
          <p className="text-white/20 text-[10px] font-black uppercase tracking-[0.4em]">Secure Encryption Active</p>
          <Link to="/" className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-xs font-bold group">
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
            Cancel & Return Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SubAgentPending;
