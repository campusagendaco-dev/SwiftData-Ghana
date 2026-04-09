import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CreditCard, Clock, CheckCircle, LogOut, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getAppBaseUrl } from "@/lib/app-base-url";

const ACTIVATION_FEE = 20;

const AgentPending = () => {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [paying, setPaying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const approvedButSetupIncomplete = Boolean(profile?.agent_approved && !profile?.onboarding_complete);

  // Auto-verify on return from Paystack
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    if (reference) {
      setVerifying(true);
      supabase.functions.invoke("verify-payment", { body: { reference } }).then(async (res) => {
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

  const handlePayActivation = async () => {
    if (!user || !profile) return;
    setPaying(true);

    const orderId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      order_type: "agent_activation",
      amount: ACTIVATION_FEE,
      profit: 0,
      status: "pending",
    });

    if (insertError) {
      toast({ title: "Failed to create order", description: insertError.message, variant: "destructive" });
      setPaying(false);
      return;
    }

    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("initialize-payment", {
      body: {
        email: profile.email || `${user.id}@agent.datahive.gh`,
        amount: ACTIVATION_FEE,
        reference: orderId,
        callback_url: `${getAppBaseUrl()}/agent/pending?reference=${orderId}`,
        metadata: {
          order_id: orderId,
          order_type: "agent_activation",
          agent_id: user.id,
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
            : "Pay a one-time activation fee of GHS 20 to activate your reseller account instantly."}
        </p>

        {!approvedButSetupIncomplete && (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6 glow-yellow">
            <div className="text-sm text-left space-y-3 mb-6">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/10">
                <CreditCard className="w-5 h-5 text-primary flex-shrink-0" />
                <div>
                  <p className="font-semibold text-foreground">Activation Fee: GHS {ACTIVATION_FEE}</p>
                  <p className="text-xs text-muted-foreground">One-time payment via Paystack (MoMo or Card)</p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                After payment, your account will be automatically approved and you can start setting up your reseller store.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={handlePayActivation}
              disabled={paying || verifying}
            >
              {paying ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
              ) : verifying ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Verifying...</>
              ) : (
                <><CreditCard className="w-5 h-5 mr-2" /> Pay GHS {ACTIVATION_FEE} to Activate</>
              )}
            </Button>
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
    </div>
  );
};

export default AgentPending;
