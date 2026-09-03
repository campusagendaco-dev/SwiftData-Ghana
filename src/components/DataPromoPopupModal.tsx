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
  CreditCard, Wallet, Smartphone, Loader2, ArrowRight, Flame, ShieldCheck, Mail
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

const NETWORK_THEMES: Record<string, { 
  headerBg: string; 
  headerText: string; 
  cardBorder: string; 
  badgeBg: string; 
  badgeText: string;
  accentGlow: string;
}> = {
  MTN: { 
    headerBg: "from-amber-400 via-yellow-400 to-amber-500", 
    headerText: "text-black font-black", 
    cardBorder: "border-amber-400/50 shadow-amber-500/20", 
    badgeBg: "bg-amber-400 text-black font-black", 
    badgeText: "text-amber-400",
    accentGlow: "bg-amber-400/20"
  },
  "MTN Mash Up": { 
    headerBg: "from-yellow-400 via-amber-400 to-yellow-500", 
    headerText: "text-black font-black", 
    cardBorder: "border-yellow-400/50 shadow-yellow-500/20", 
    badgeBg: "bg-yellow-400 text-black font-black", 
    badgeText: "text-yellow-400",
    accentGlow: "bg-yellow-400/20"
  },
  Telecel: { 
    headerBg: "from-red-600 via-rose-600 to-red-700", 
    headerText: "text-white font-black", 
    cardBorder: "border-red-500/50 shadow-red-500/20", 
    badgeBg: "bg-red-500 text-white font-bold", 
    badgeText: "text-red-400",
    accentGlow: "bg-red-500/20"
  },
  AirtelTigo: { 
    headerBg: "from-blue-600 via-indigo-600 to-blue-700", 
    headerText: "text-white font-black", 
    cardBorder: "border-indigo-500/50 shadow-indigo-500/20", 
    badgeBg: "bg-indigo-500 text-white font-bold", 
    badgeText: "text-indigo-400",
    accentGlow: "bg-indigo-500/20"
  },
};

export const DataPromoPopupModal = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activePromo, setActivePromo] = useState<DataPromoPopup | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "momo">("momo");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [showPaystackCheckout, setShowPaystackCheckout] = useState(false);

  // Fetch logged in user details & wallet balance if user exists
  useEffect(() => {
    if (user) {
      setPaymentMethod("wallet");
      const fetchUserData = async () => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("phone, email")
          .eq("user_id", user.id)
          .maybeSingle();

        if (profile?.phone) setPhone(profile.phone);
        if (user.email) setGuestEmail(user.email);

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
    } else {
      setPaymentMethod("momo");
    }
  }, [user]);

  // Fetch active data promo popup (works for both guests & logged in users)
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

          // Audience check: if target_audience is "agents" and user is guest, skip
          if (p.target_audience === "agents" && !user) return false;
          
          // Check local storage for recent dismiss
          const dismissed = localStorage.getItem(`swift_promo_dismissed_${p.id}`);
          if (dismissed) return false;

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
          // Show popup after 1s for smooth initial page view UX
          const timer = setTimeout(() => setIsOpen(true), 1000);
          return () => clearTimeout(timer);
        }
      } catch (err) {
        console.error("Error fetching promo popup:", err);
      }
    };

    fetchActivePromo();
  }, [user]);

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
      toast({ title: "Recipient Phone Required", description: "Please enter your recipient phone number.", variant: "destructive" });
      return;
    }

    if (walletBalance !== null && walletBalance < activePromo.promo_price) {
      toast({ 
        title: "Insufficient Wallet Balance", 
        description: `Your balance is GH₵ ${walletBalance.toFixed(2)}. Switching to MoMo payment option.`, 
        variant: "destructive" 
      });
      setPaymentMethod("momo");
      return;
    }

    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

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
        throw new Error(resData.error || "Failed to process promo order");
      }

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
      toast({ title: "Recipient Phone Required", description: "Please enter your recipient phone number to receive data.", variant: "destructive" });
      return;
    }
    setShowPaystackCheckout(true);
  };

  const handlePaystackSuccess = async () => {
    setShowPaystackCheckout(false);
    if (!activePromo) return;

    try {
      await supabase.rpc("increment_data_promo_claim", { p_promo_id: activePromo.id });
      setPurchaseSuccess(true);
      toast({ title: "🎉 Payment & Order Successful!", description: `Promotional ${activePromo.package_size} bundle dispatched to ${phone}.` });
    } catch (err: any) {
      console.error(err);
    }
  };

  if (!activePromo) return null;

  const theme = NETWORK_THEMES[activePromo.network] || NETWORK_THEMES.MTN;
  const discountPercent = activePromo.original_price > activePromo.promo_price
    ? Math.round(((activePromo.original_price - activePromo.promo_price) / activePromo.original_price) * 100)
    : 0;

  const resolvedEmail = user?.email || guestEmail.trim() || `guest_${phone.replace(/\D/g, "")}@swiftdatagh.shop`;

  return (
    <>
      {/* Floating MTN-Ghana Style Re-open Pill (when dismissed) */}
      {!isOpen && activePromo && (
        <button
          onClick={handleReopen}
          className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-2xl shadow-amber-500/40 border-2 border-amber-300 hover:scale-105 active:scale-95 transition-all duration-300 animate-bounce"
        >
          <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          </div>
          <span className="truncate max-w-[200px] md:max-w-none font-black">
            {activePromo.badge_text || "MTN YELLO PROMO"} • {activePromo.package_size} @ GH₵ {activePromo.promo_price.toFixed(2)}
          </span>
        </button>
      )}

      {/* Main MTN Ghana Inspired Promo Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[490px] p-0 overflow-hidden border-none bg-transparent shadow-2xl z-[150]">
          <div className={`relative overflow-hidden rounded-[2.5rem] bg-[#0A0E0A] border-2 ${theme.cardBorder} shadow-2xl`}>
            
            {/* Ambient Background Glows */}
            <div className={`absolute top-0 right-0 w-80 h-80 ${theme.accentGlow} rounded-full blur-[110px] -translate-y-1/2 translate-x-1/2 pointer-events-none animate-pulse`} />
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-[110px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

            {/* Top Brand Banner Header */}
            {activePromo.banner_image_url ? (
              <div className="relative h-48 w-full overflow-hidden">
                <img src={activePromo.banner_image_url} alt={activePromo.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0E0A] via-[#0A0E0A]/50 to-transparent" />
              </div>
            ) : (
              <div className={`py-6 px-6 bg-gradient-to-r ${theme.headerBg} relative overflow-hidden flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-black/90 border border-white/20 flex items-center justify-center shadow-lg shrink-0">
                    <Zap className="w-6 h-6 text-amber-400 fill-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <Badge className="bg-black/90 text-amber-400 border border-amber-400/40 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 mb-0.5">
                      MTN GHANA PROMO DEAL 🚀
                    </Badge>
                    <h3 className="font-black text-black text-lg tracking-tight leading-none">
                      {activePromo.network} High-Speed Data
                    </h3>
                  </div>
                </div>

                {discountPercent > 0 && (
                  <div className="bg-black text-amber-400 font-black text-xs px-3 py-1.5 rounded-xl border border-amber-400/40 shadow-lg shrink-0">
                    SAVE {discountPercent}%
                  </div>
                )}
              </div>
            )}

            {/* Modal Body */}
            <div className="p-6 md:p-7 relative z-10 space-y-5">
              
              {/* Badges & Timer Strip */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className={`${theme.badgeBg} text-xs px-3 py-1 rounded-xl shadow-md uppercase tracking-wider`}>
                    {activePromo.badge_text || `${activePromo.network} DEAL`}
                  </Badge>
                  <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" /> Instant Delivery
                  </span>
                </div>

                {timeRemaining && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-mono font-bold shadow-sm">
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>{timeRemaining}</span>
                  </div>
                )}
              </div>

              {/* Title & Subtitle */}
              <DialogHeader className="text-left space-y-1">
                <DialogTitle className="text-2xl font-black text-white tracking-tight leading-snug">
                  {activePromo.title}
                </DialogTitle>
                <DialogDescription className="text-white/70 text-sm leading-relaxed">
                  {activePromo.description || `Get high-speed non-expiry ${activePromo.network} data bundle sent directly to your phone number.`}
                </DialogDescription>
              </DialogHeader>

              {/* Deal Pricing Showcase Box */}
              <div className="rounded-3xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/15 p-5 flex items-center justify-between shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-400/10 rounded-full blur-xl pointer-events-none" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-0.5">Special Bundle</p>
                  <p className="text-3xl font-black text-white tracking-tight">{activePromo.package_size}</p>
                </div>

                <div className="text-right">
                  {activePromo.original_price > activePromo.promo_price && (
                    <p className="text-xs line-through text-white/40 font-bold mb-0.5">
                      GH₵ {activePromo.original_price.toFixed(2)}
                    </p>
                  )}
                  <div className="flex items-baseline gap-1">
                    <span className="text-xs font-bold text-amber-400">GH₵</span>
                    <span className="text-3xl font-black text-amber-400 tracking-tight">
                      {activePromo.promo_price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Purchase Form or Success State */}
              {purchaseSuccess ? (
                <div className="text-center py-6 space-y-4 animate-in zoom-in-95 duration-300">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-xl">
                    <CheckCircle2 className="w-10 h-10 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white mb-1">Data Delivered! 🎉</h3>
                    <p className="text-xs text-white/70">
                      Your promotional <span className="text-amber-400 font-bold">{activePromo.package_size}</span> bundle has been dispatched to <span className="text-amber-400 font-mono font-bold">{phone}</span>.
                    </p>
                  </div>
                  <Button
                    onClick={() => { setPurchaseSuccess(false); setIsOpen(false); }}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black rounded-2xl h-12 text-sm uppercase tracking-wider shadow-xl shadow-emerald-500/20"
                  >
                    Awesome, Thank You!
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Recipient Phone Input */}
                  <div>
                    <Label className="text-xs font-bold text-white/80 mb-1.5 block uppercase tracking-wider">
                      Recipient Mobile Number
                    </Label>
                    <div className="relative">
                      <Input
                        type="tel"
                        placeholder="e.g. 0244123456"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="bg-white/5 border-white/15 text-white rounded-2xl h-12 font-mono text-base pl-11 focus:border-amber-400 focus:ring-amber-400/20"
                      />
                      <Smartphone className="w-5 h-5 text-amber-400 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  {/* Payment Method Selection */}
                  <div>
                    <Label className="text-xs font-bold text-white/80 mb-1.5 block uppercase tracking-wider">
                      Payment Method
                    </Label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {user && (
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("wallet")}
                          className={`p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                            paymentMethod === "wallet"
                              ? "border-amber-400 bg-amber-400/10 text-white shadow-lg shadow-amber-500/10"
                              : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                          }`}
                        >
                          <Wallet className={`w-5 h-5 ${paymentMethod === "wallet" ? "text-amber-400" : ""}`} />
                          <div>
                            <p className="text-xs font-bold leading-tight">Wallet Balance</p>
                            {walletBalance !== null && (
                              <p className="text-[10px] text-amber-400 font-mono font-bold mt-0.5">GH₵ {walletBalance.toFixed(2)}</p>
                            )}
                          </div>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("momo")}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                          !user ? "col-span-2" : ""
                        } ${
                          paymentMethod === "momo"
                            ? "border-amber-400 bg-amber-400/10 text-white shadow-lg shadow-amber-500/10"
                            : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                        }`}
                      >
                        <CreditCard className={`w-5 h-5 ${paymentMethod === "momo" ? "text-amber-400" : ""}`} />
                        <div>
                          <p className="text-xs font-bold leading-tight">Mobile Money (MoMo / Card)</p>
                          <p className="text-[10px] text-white/40 mt-0.5">MTN MoMo, Telecel Cash, AT Money</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Submit 1-Click Purchase Action Button */}
                  {paymentMethod === "wallet" && user ? (
                    <Button
                      onClick={handleBuyWithWallet}
                      disabled={loading || !phone}
                      className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black h-13 rounded-2xl text-sm uppercase tracking-wider shadow-xl shadow-amber-500/25 gap-2 transition-all active:scale-98"
                    >
                      {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Zap className="w-5 h-5 fill-black" /> Buy Now for GH₵ {activePromo.promo_price.toFixed(2)}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleBuyWithMomo}
                      disabled={!phone}
                      className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black h-13 rounded-2xl text-sm uppercase tracking-wider shadow-xl shadow-amber-500/25 gap-2 transition-all active:scale-98"
                    >
                      <CreditCard className="w-5 h-5" /> Pay with MoMo (GH₵ {activePromo.promo_price.toFixed(2)})
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Close Button Override */}
            <button
              onClick={handleDismiss}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black transition-all border border-white/20 text-white/70 hover:text-white z-30"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paystack MoMo Checkout Integration for Guest & MoMo Users */}
      {showPaystackCheckout && activePromo && (
        <PaystackMomoCheckout
          isOpen={showPaystackCheckout}
          onClose={() => setShowPaystackCheckout(false)}
          amount={activePromo.promo_price}
          email={resolvedEmail}
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
