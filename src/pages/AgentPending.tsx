import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CreditCard, Clock, CheckCircle, LogOut, Loader2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { invokePublicFunction, invokePublicFunctionAsUser } from "@/lib/public-function-client";
import { supabase } from "@/integrations/supabase/client";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";

const AgentPending = () => {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutReference, setCheckoutReference] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [activationFee, setActivationFee] = useState(50);
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoLimit, setPromoLimit] = useState(10);
  const [promoClaimed, setPromoClaimed] = useState(0);
  
  const PAYSTACK_FEE_RATE = 0.03;
  const PAYSTACK_FEE_CAP = 100;
  const paystackFee = Math.min(activationFee * PAYSTACK_FEE_RATE, PAYSTACK_FEE_CAP);
  const activationTotal = parseFloat((activationFee + paystackFee).toFixed(2));

  const isPromoActive = promoEnabled && promoClaimed < promoLimit;
  const remainingSlots = Math.max(0, promoLimit - promoClaimed);

  const approvedButSetupIncomplete = Boolean(profile?.agent_approved && !profile?.onboarding_complete);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      // 1. Check if paid
      const { data: orderData } = await supabase
        .from("orders")
        .select("status")
        .eq("agent_id", user.id)
        .eq("order_type", "agent_activation")
        .in("status", ["paid", "fulfilled"])
        .maybeSingle();
      
      if (orderData) setHasPaid(true);

      // 2. Fetch dynamic fee & promo status
      try {
        const { data: settings } = await supabase
          .from("public_system_settings")
          .select("agent_activation_fee, free_agent_promo_enabled, free_agent_promo_limit, free_agent_promo_claimed")
          .eq("id", 1)
          .maybeSingle();
        if (settings) {
          if (settings.agent_activation_fee) setActivationFee(Number(settings.agent_activation_fee));
          setPromoEnabled(Boolean(settings.free_agent_promo_enabled));
          setPromoLimit(Number(settings.free_agent_promo_limit || 10));
          setPromoClaimed(Number(settings.free_agent_promo_claimed || 0));
        }
      } catch (e) {
        console.error("Error fetching settings:", e);
      }
    };
    fetchData();
  }, [user]);

  // Auto-verify on return from Paystack
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference) {
      setVerifying(true);
      invokePublicFunctionAsUser("verify-payment", { body: { reference } }).then(async (res) => {
        if (res.data?.status === "fulfilled") {
          toast({ title: "Activation successful!", description: "Your reseller account is now active." });
          await refreshProfile();
        } else {
          toast({ title: "Payment received", description: "Verifying your activation. Please check status." });
          await refreshProfile();
        }
        window.history.replaceState({}, "", window.location.pathname);
        setVerifying(false);
      }).catch(() => {
        toast({ title: "Verification pending", description: "Please tap Check Status.", variant: "destructive" });
        window.history.replaceState({}, "", window.location.pathname);
        setVerifying(false);
      });
    }
  }, [refreshProfile, toast]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const handleClaimFreePromo = async () => {
    setPaying(true);
    const { data, error } = await supabase.rpc("claim_free_agent_promo");
    const res = data as any;

    if (error || !res?.success) {
      toast({
        title: "Promotion unavailable",
        description: error?.message || res?.error || "Failed to secure free slot. Reverting to normal payments.",
        variant: "destructive"
      });
      setPaying(false);
      // Refresh local context to accurately represent promo counts if limit filled
      setTimeout(() => window.location.reload(), 1500);
      return;
    }

    toast({
      title: "🎉 Free Promotion Activated!",
      description: "Your reseller request is fully approved for FREE! Setting up store next.",
    });

    await refreshProfile();
    navigate("/onboarding");
    setPaying(false);
  };

  const handlePayActivation = async () => {
    if (!user || !profile) return;
    const orderId = crypto.randomUUID();
    setCheckoutReference(orderId);
    setCheckoutOpen(true);
  };

  const handleCheckoutSuccess = async (ref: string) => {
    setCheckoutOpen(false);
    toast({ title: "Payment successful!", description: "Your activation payment has been received." });
    setHasPaid(true);
    await refreshProfile();
  };

  const handleCheckoutFailure = (err: string) => {
    setCheckoutOpen(false);
    toast({ title: "Payment failed", description: err || "The payment could not be completed.", variant: "destructive" });
  };

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        {approvedButSetupIncomplete ? (
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
        ) : (
          <Clock className="w-16 h-16 text-primary mx-auto mb-6" />
        )}
        <h1 className="font-display text-2xl font-black mb-3">
          {approvedButSetupIncomplete ? "Approval Granted" : "Activate Your Reseller Account"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {approvedButSetupIncomplete
            ? "Your reseller request is approved. Click check status to continue with setup."
            : hasPaid 
              ? "Your activation payment has been received! We are now reviewing your store details. You will be notified once approved."
              : isPromoActive 
                ? `Wait! You are eligible to activate 100% FREE! Claim one of ${remainingSlots} remaining free reseller spots right now!`
                : `Pay a one-time activation fee of GHS ${activationFee} + GHS ${paystackFee.toFixed(2)} transaction fee (Total: GHS ${activationTotal.toFixed(2)}) to activate your reseller account instantly.`}
        </p>

        {!approvedButSetupIncomplete && (
          <div className={`bg-card border rounded-2xl p-6 mb-6 ${isPromoActive ? "glow-green border-green-500/30 relative overflow-hidden animate-in fade-in" : "glow-yellow border-border"}`}>
            {isPromoActive && !hasPaid && (
              <div className="absolute top-0 right-0 left-0 bg-green-500/10 text-green-400 py-1 text-[10px] font-bold uppercase tracking-wider border-b border-green-500/10">
                🔥 Free Agent Promo Active
              </div>
            )}
            <div className={isPromoActive && !hasPaid ? "mt-3" : ""}>
              {hasPaid ? (
                <div className="py-4 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Clock className="w-8 h-8 text-primary animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-foreground">Awaiting Admin Approval</p>
                    <p className="text-xs text-muted-foreground">Your payment was successful. Our team usually approves accounts within 1-2 hours.</p>
                  </div>
                  <Button variant="outline" onClick={refreshProfile} className="w-full mt-2">
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh Status
                  </Button>
                </div>
              ) : (
                <>
                  <div className="text-sm text-left space-y-3 mb-6">
                    <div className={`flex items-center gap-3 p-3 rounded-xl border ${isPromoActive ? "bg-green-500/5 border-green-500/20" : "bg-primary/5 border-primary/10"}`}>
                      {isPromoActive ? (
                        <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                      ) : (
                        <CreditCard className="w-5 h-5 text-primary flex-shrink-0" />
                      )}
                      <div>
                        <p className={`font-semibold ${isPromoActive ? "text-green-400" : "text-foreground"}`}>
                          {isPromoActive ? "Activation Fee: GHS 0 (FREE)" : `Activation Fee: GHS ${activationFee}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isPromoActive ? `Normally GHS ${activationTotal.toFixed(2)} total` : `+ GHS ${paystackFee.toFixed(2)} Paystack fee = GHS ${activationTotal.toFixed(2)} total`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isPromoActive ? "Active promotion for the first few signups" : "One-time payment via Paystack (MoMo or Card)"}
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {isPromoActive 
                        ? "Tap Claim below to bypass standard activation payment instantly. Only valid while slots remain." 
                        : "After payment, our team will review and approve your account so you can start setting up your reseller store."
                      }
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className={`w-full ${isPromoActive ? "bg-green-500 hover:bg-green-600 text-white font-bold border-0 shadow-lg shadow-green-500/20 animate-pulse hover:animate-none" : ""}`}
                    onClick={isPromoActive ? handleClaimFreePromo : handlePayActivation}
                    disabled={paying || verifying}
                  >
                    {paying ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
                    ) : verifying ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Verifying...</>
                    ) : isPromoActive ? (
                      <><CheckCircle className="w-5 h-5 mr-2" /> Claim My Free Slot Now</>
                    ) : (
                      <><CreditCard className="w-5 h-5 mr-2" /> Pay GHS {activationTotal.toFixed(2)} to Activate</>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Button variant="outline" onClick={refreshProfile} className="w-full">
            <CheckCircle className="w-4 h-4 mr-2" />
            Check Approval Status
          </Button>
          <Button variant="ghost" onClick={handleSignOut} className="w-full text-muted-foreground">
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
      <PaystackMomoCheckout
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        amount={activationTotal}
        email={profile?.email || user?.email || ""}
        recipientPhone={""}
        recipientNetwork={""}
        metadata={{
          order_id: checkoutReference,
          order_type: "agent_activation",
          agent_id: user?.id,
          base_amount: activationFee,
          paystack_fee: paystackFee,
        }}
        onSuccess={handleCheckoutSuccess}
        onFailure={handleCheckoutFailure}
      />
    </div>
  );
};

export default AgentPending;
