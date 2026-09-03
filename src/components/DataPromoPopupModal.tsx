import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Zap, Gift, X, Sparkles, Clock, CheckCircle2, 
  CreditCard, Wallet, Smartphone, Loader2, ArrowRight, Flame 
} from "lucide-react";
import { PaystackMomoCheckout } from "@/components/PaystackMomoCheckout";

export interface DataPromoPopup {
  id: string;
  title: string;
  description: string | null;
  network: string;
  package_size: string;
  original_price: number;
  promo_price: number;
  badge_text: string | null;
  banner_image_url: string | null;
  theme_color: string;
  target_audience: string;
  expires_at: string | null;
  max_claims: number;
  claimed_count: number;
  per_user_limit: number;
  is_active: boolean;
}

const NETWORK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  MTN: { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30" },
  Telecel: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/30" },
  AirtelTigo: { bg: "bg-indigo-500/20", text: "text-indigo-400", border: "border-indigo-500/30" },
  "MTN Mash Up": { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/30" },
};

export const DataPromoPopupModal = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activePromo, setActivePromo] = useState<DataPromoPopup | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "momo">("wallet");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [showPaystackCheckout, setShowPaystackCheckout] = useState(false);

  // Fetch user details & wallet balance
  useEffect(() => {
    if (!user) return;
    const fetchUserData = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.phone) {
        setPhone(profile.phone);
      }

      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();

      if (wallet) {
        setWalletBalance(Number(wallet.balance) || 0);
      }
    };
    fetchUserData();
  }, [user]);

  // Fetch active data promo popup
  useEffect(() => {
    const fetchActivePromo = async () => {
      try {
        const { data, error } = await supabase
          .from("data_promo_popups")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (error || !data || data.length === 0) return;

        // Find eligible promo
        const now = new Date();
        const validPromo = data.find((p: any) => {
          if (p.expires_at && new Date(p.expires_at) <= now) return false;
          if (p.max_claims > 0 && p.claimed_count >= p.max_claims) return false;
          
          // Check if user dismissed this specific promo in local storage recently
          const dismissedId = localStorage.getItem(`swift_promo_dismissed_${p.id}`);
          if (dismissedId) return false;

          return true;
        });

        if (validPromo) {
          const promoItem: DataPromoPopup = {
            id: validPromo.id,
            title: validPromo.title,
            description: validPromo.description,
            network: validPromo.network,
            package_size: validPromo.package_size,
            original_price: Number(validPromo.original_price),
            promo_price: Number(validPromo.promo_price),
            badge_text: validPromo.badge_text,
            banner_image_url: validPromo.banner_image_url,
            theme_color: validPromo.theme_color || "amber",
            target_audience: validPromo.target_audience || "all",
            expires_at: validPromo.expires_at,
            max_claims: Number(validPromo.max_claims || 0),
            claimed_count: Number(validPromo.claimed_count || 0),
            per_user_limit: Number(validPromo.per_user_limit || 1),
            is_active: Boolean(validPromo.is_active),
          };

          setActivePromo(promoItem);
          // Show popup with slight delay for smooth initial load UX
          const timer = setTimeout(() => setIsOpen(true), 1200);
          return () => clearTimeout(timer);
        }
      } catch (err) {
        console.error("Error loading promo popup:", err);
      }
    };

    fetchActivePromo();
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (!activePromo?.expires_at) {
      setTimeRemaining(null);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expiry = new Date(activePromo.expires_at!).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeRemaining("Expired");
        clearInterval(interval);
        setIsOpen(false);
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeRemaining(
          `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activePromo]);

  const handleDismiss = () => {
    if (activePromo) {
      localStorage.setItem(`swift_promo_dismissed_${activePromo.id}`, "true");
    }
    setIsOpen(false);
  };

  const handleReopen = () => {
    setIsOpen(true);
  };

  const handleBuyWithWallet = async () => {
    if (!activePromo) return;
    if (!phone.trim()) {
      toast({ title: "Recipient Phone Required", description: "Please enter the phone number to receive data.", variant: "destructive" });
      return;
    }

    if (walletBalance !== null && walletBalance < activePromo.promo_price) {
      toast({ 
        title: "Insufficient Wallet Balance", 
        description: `Your balance is GH₵ ${walletBalance.toFixed(2)}. Switch to MoMo payment or top up your wallet.`, 
        variant: "destructive" 
      });
      setPaymentMethod("momo");
      return;
    }

    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      // Invoke wallet-buy-data edge function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || "https://wixlygyluclomgvgndhh.supabase.co"}/functions/v1/wallet-buy-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            network: activePromo.network,
            package_size: activePromo.package_size,
            customer_phone: phone.trim(),
            amount: activePromo.promo_price,
            metadata: {
              promo_id: activePromo.id,
              is_data_traffic_promo: true,
            },
          }),
        }
      );

      const resData = await response.json();

      if (!response.ok || resData.error) {
        throw new Error(resData.error || "Failed to process purchase");
      }

      // Increment claim count in DB
      await supabase.rpc("increment_data_promo_claim", { p_promo_id: activePromo.id });

      setPurchaseSuccess(true);
      toast({ title: "🎉 Order Successful!", description: `Promotional ${activePromo.package_size} sent to ${phone.trim()}` });
    } catch (err: any) {
      toast({ title: "Purchase Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleBuyWithMomo = () => {
    if (!phone.trim()) {
      toast({ title: "Recipient Phone Required", description: "Please enter the phone number to receive data.", variant: "destructive" });
      return;
    }
    setShowPaystackCheckout(true);
  };

  const handlePaystackSuccess = async (reference: string) => {
    setShowPaystackCheckout(false);
    if (!activePromo) return;

    try {
      // Increment claim count in DB
      await supabase.rpc("increment_data_promo_claim", { p_promo_id: activePromo.id });
      setPurchaseSuccess(true);
      toast({ title: "🎉 Payment & Order Successful!", description: `Promotional ${activePromo.package_size} bundle processed.` });
    } catch (err: any) {
      console.error(err);
    }
  };

  if (!activePromo) return null;

  const netColors = NETWORK_COLORS[activePromo.network] || NETWORK_COLORS.MTN;
  const discountPercent = activePromo.original_price > activePromo.promo_price
    ? Math.round(((activePromo.original_price - activePromo.promo_price) / activePromo.original_price) * 100)
    : 0;

  return (
    <>
      {/* Non-intrusive Floating Deal Re-open Pill (when popup closed) */}
      {!isOpen && activePromo && (
        <button
          onClick={handleReopen}
          className="fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black text-xs uppercase tracking-wider shadow-2xl shadow-amber-500/30 hover:scale-105 active:scale-95 transition-all duration-300 animate-bounce"
        >
          <Flame className="w-4 h-4 text-black animate-pulse" />
          <span>{activePromo.badge_text || "Promo Deal"} ({activePromo.package_size} @ GH₵ {activePromo.promo_price.toFixed(2)})</span>
        </button>
      )}

      {/* Main Promo Pop-Up Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none bg-transparent shadow-2xl z-[150]">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[#0A0D0A] border border-amber-500/20 shadow-2xl shadow-amber-500/10">
            {/* Animated Glow Accents */}
            <div className="absolute top-0 right-0 w-72 h-72 bg-amber-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 animate-pulse pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

            {/* Header / Banner */}
            {activePromo.banner_image_url ? (
              <div className="relative h-44 w-full overflow-hidden">
                <img src={activePromo.banner_image_url} alt={activePromo.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D0A] via-[#0A0D0A]/40 to-transparent" />
              </div>
            ) : (
              <div className="pt-8 px-6 pb-2 text-center relative z-10">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-3 shadow-xl">
                  <Gift className="w-8 h-8 text-amber-400 animate-bounce" />
                </div>
              </div>
            )}

            {/* Content Wrapper */}
            <div className="relative z-10 px-6 pb-8 pt-2">
              {/* Badges & Timer Bar */}
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Badge className={`${netColors.bg} ${netColors.text} ${netColors.border} font-bold text-xs px-3 py-1 rounded-xl`}>
                    {activePromo.network}
                  </Badge>
                  {discountPercent > 0 && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-black text-xs px-2.5 py-1 rounded-xl">
                      SAVE {discountPercent}%
                    </Badge>
                  )}
                </div>

                {timeRemaining && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-amber-400 font-bold">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{timeRemaining}</span>
                  </div>
                )}
              </div>

              {/* Title & Description */}
              <DialogHeader className="text-left mb-5">
                <DialogTitle className="text-2xl font-black text-white tracking-tight leading-snug">
                  {activePromo.title}
                </DialogTitle>
                {activePromo.description && (
                  <DialogDescription className="text-white/60 text-sm mt-1 leading-relaxed">
                    {activePromo.description}
                  </DialogDescription>
                )}
              </DialogHeader>

              {/* Pricing Display Card */}
              <div className="rounded-2xl bg-gradient-to-r from-white/[0.04] to-white/[0.02] border border-white/10 p-4 mb-5 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Package Deal</p>
                  <p className="text-2xl font-black text-white tracking-tight">{activePromo.package_size} Data</p>
                </div>
                <div className="text-right">
                  {activePromo.original_price > activePromo.promo_price && (
                    <p className="text-xs line-through text-white/40 font-bold">GH₵ {activePromo.original_price.toFixed(2)}</p>
                  )}
                  <p className="text-2xl font-black text-amber-400 tracking-tight">
                    GH₵ {activePromo.promo_price.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Purchase Form or Success State */}
              {purchaseSuccess ? (
                <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-300">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                    <CheckCircle2 className="w-10 h-10 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-1">Data Delivered! 🎉</h3>
                    <p className="text-xs text-white/60">
                      Your promotional {activePromo.package_size} bundle has been dispatched to <span className="text-amber-400 font-mono font-bold">{phone}</span>.
                    </p>
                  </div>
                  <Button
                    onClick={() => { setPurchaseSuccess(false); setIsOpen(false); }}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl h-11"
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Recipient Phone Input */}
                  <div>
                    <Label className="text-xs text-white/60 mb-1.5 block font-semibold">Recipient Phone Number</Label>
                    <div className="relative">
                      <Input
                        type="tel"
                        placeholder="024XXXXXXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="bg-white/5 border-white/10 text-white rounded-xl h-11 font-mono text-sm pl-10 focus:border-amber-400/50"
                      />
                      <Smartphone className="w-4 h-4 text-white/40 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  {/* Payment Method Selector */}
                  <div>
                    <Label className="text-xs text-white/60 mb-1.5 block font-semibold">Select Payment Method</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("wallet")}
                        className={`p-3 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                          paymentMethod === "wallet"
                            ? "border-amber-400 bg-amber-400/10 text-white"
                            : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                        }`}
                      >
                        <Wallet className={`w-4 h-4 ${paymentMethod === "wallet" ? "text-amber-400" : ""}`} />
                        <div>
                          <p className="text-xs font-bold leading-none">Wallet</p>
                          {walletBalance !== null && (
                            <p className="text-[10px] text-white/40 mt-1 font-mono">GH₵ {walletBalance.toFixed(2)}</p>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("momo")}
                        className={`p-3 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                          paymentMethod === "momo"
                            ? "border-amber-400 bg-amber-400/10 text-white"
                            : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                        }`}
                      >
                        <CreditCard className={`w-4 h-4 ${paymentMethod === "momo" ? "text-amber-400" : ""}`} />
                        <div>
                          <p className="text-xs font-bold leading-none">MoMo / Card</p>
                          <p className="text-[10px] text-white/40 mt-1">Instant Paystack</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Submit Action Button */}
                  {paymentMethod === "wallet" ? (
                    <Button
                      onClick={handleBuyWithWallet}
                      disabled={loading || !phone}
                      className="w-full bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-black font-black h-12 rounded-xl text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20 gap-2 transition-all active:scale-98"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Zap className="w-4 h-4" /> Buy Now for GH₵ {activePromo.promo_price.toFixed(2)}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleBuyWithMomo}
                      disabled={!phone}
                      className="w-full bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-black font-black h-12 rounded-xl text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20 gap-2 transition-all active:scale-98"
                    >
                      <CreditCard className="w-4 h-4" /> Pay with MoMo (GH₵ {activePromo.promo_price.toFixed(2)})
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Close Button Override */}
            <button
              onClick={handleDismiss}
              className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10 text-white/50 hover:text-white z-20"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paystack Checkout Modal Integration */}
      {showPaystackCheckout && activePromo && (
        <PaystackMomoCheckout
          isOpen={showPaystackCheckout}
          onClose={() => setShowPaystackCheckout(false)}
          amount={activePromo.promo_price}
          email={user?.email || "customer@swiftdata.gh"}
          recipientPhone={phone}
          recipientNetwork={activePromo.network}
          metadata={{ promo_id: activePromo.id, is_data_promo: true, package_size: activePromo.package_size }}
          onSuccess={handlePaystackSuccess}
          onFailure={(err) => toast({ title: "Payment Failed", description: err, variant: "destructive" })}
        />
      )}
    </>
  );
};
