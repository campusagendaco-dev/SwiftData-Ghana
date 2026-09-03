import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "react-router-dom";
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
import { getActiveStoreDomain } from "@/lib/app-base-url";

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
          .eq("agent_id", user.id)
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

  const location = useLocation();
  const activeDomain = getActiveStoreDomain();
  const currentPath = location?.pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  const isAgentStorefront = Boolean(
    activeDomain ||
    currentPath.startsWith("/store") ||
    currentPath.includes("/store")
  );

  // Fetch active data promo popup (works for both guests & logged in users)
  useEffect(() => {
    if (isAgentStorefront) return;

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

          // Clear any legacy permanent localStorage locks
          localStorage.removeItem(`swift_promo_dismissed_${validPromo.id}`);

          // Check if dismissed in current browser tab session
          const sessionDismissed = sessionStorage.getItem(`swift_promo_dismissed_${validPromo.id}`);
          if (!sessionDismissed) {
            const timer = setTimeout(() => setIsOpen(true), 800);
            return () => clearTimeout(timer);
          }
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
      sessionStorage.setItem(`swift_promo_dismissed_${activePromo.id}`, "true");
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
      const { data: resData, error: invokeErr } = await supabase.functions.invoke("wallet-buy-data", {
        body: {
          network: activePromo.network,
          package_size: activePromo.package_size,
          customer_phone: phone.trim(),
          amount: activePromo.promo_price,
          metadata: {
            promo_id: activePromo.id,
            is_data_traffic_promo: true,
          },
        }
      });

      if (invokeErr || resData?.error) {
        throw new Error(resData?.error || invokeErr?.message || "Failed to process promo order");
      }

      supabase.rpc("increment_data_promo_claim", { p_promo_id: activePromo.id }).catch(console.error);
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

  if (isAgentStorefront || !activePromo) return null;

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

      {/* Main Cute Promo Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[365px] p-0 overflow-hidden border-none bg-transparent shadow-2xl z-[150]">
          <div className={`relative overflow-hidden rounded-[1.75rem] bg-[#0C0F0E] border border-amber-400/40 shadow-2xl shadow-amber-500/15`}>

            {/* Ambient Background Glows */}
            <div className={`absolute top-0 right-0 w-48 h-48 ${theme.accentGlow} rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none animate-pulse`} />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 pointer-events-none" />

            {/* Top Brand Banner Header (Cute & Compact) */}
            {activePromo.banner_image_url ? (
              <div className="relative h-32 w-full overflow-hidden">
                <img src={activePromo.banner_image_url} alt={activePromo.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0C0F0E] via-[#0C0F0E]/50 to-transparent" />
              </div>
            ) : (
              <div className={`py-3 px-4 bg-gradient-to-r ${theme.headerBg} relative overflow-hidden flex items-center justify-between pr-10`}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-black/90 border border-white/20 flex items-center justify-center shadow-md shrink-0">
                    <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-black text-black text-xs tracking-tight leading-none">
                      {activePromo.network} Special Deal 🚀
                    </h3>
                  </div>
                </div>

                {discountPercent > 0 && (
                  <div className="bg-black text-amber-400 font-black text-[10px] px-2 py-0.5 rounded-full border border-amber-400/40 shadow-sm shrink-0">
                    {discountPercent}% OFF
                  </div>
                )}
              </div>
            )}

            {/* Modal Body */}
            <div className="p-4 relative z-10 space-y-3.5">
              
              {/* Badges & Timer Strip */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <Badge className={`${theme.badgeBg} text-[10px] px-2.5 py-0.5 rounded-full shadow-sm uppercase tracking-wider`}>
                    {activePromo.badge_text || `${activePromo.network} PROMO`}
                  </Badge>
                  <span className="text-[9px] font-bold text-white/50 uppercase tracking-widest flex items-center gap-1">
                    <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" /> Instant
                  </span>
                </div>

                {timeRemaining && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/30 text-amber-400 text-[10px] font-mono font-bold shadow-sm">
                    <Clock className="w-3 h-3 animate-spin" />
                    <span>{timeRemaining}</span>
                  </div>
                )}
              </div>

              {/* Title & Subtitle */}
              <DialogHeader className="text-left space-y-0.5">
                <DialogTitle className="text-base font-black text-white tracking-tight leading-tight flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
                  <span>{activePromo.title}</span>
                </DialogTitle>
                <DialogDescription className="text-white/60 text-[11px] leading-snug">
                  {activePromo.description || `Get high-speed non-expiry ${activePromo.network} data bundle sent directly to your phone.`}
                </DialogDescription>
              </DialogHeader>

              {/* Deal Pricing Showcase Box (Cute Compact Pill) */}
              <div className="rounded-2xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/15 p-3 flex items-center justify-between shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-amber-400/10 rounded-full blur-lg pointer-events-none" />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-400 mb-0.5">Special Bundle</p>
                  <p className="text-2xl font-black text-white tracking-tight leading-none">{activePromo.package_size}</p>
                </div>

                <div className="text-right">
                  {activePromo.original_price > activePromo.promo_price && (
                    <p className="text-[10px] line-through text-white/40 font-bold leading-none mb-0.5">
                      GH₵ {activePromo.original_price.toFixed(2)}
                    </p>
                  )}
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-[10px] font-bold text-amber-400">GH₵</span>
                    <span className="text-2xl font-black text-amber-400 tracking-tight leading-none">
                      {activePromo.promo_price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Purchase Form or Success State */}
              {purchaseSuccess ? (
                <div className="text-center py-4 space-y-3 animate-in zoom-in-95 duration-300">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-lg">
                    <CheckCircle2 className="w-7 h-7 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white mb-0.5">Data Delivered! 🎉</h3>
                    <p className="text-[11px] text-white/70">
                      Promotional <span className="text-amber-400 font-bold">{activePromo.package_size}</span> sent to <span className="text-amber-400 font-mono font-bold">{phone}</span>.
                    </p>
                  </div>
                  <Button
                    onClick={() => { setPurchaseSuccess(false); setIsOpen(false); }}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black rounded-xl h-10 text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20"
                  >
                    Awesome, Thank You!
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Recipient Phone Input */}
                  <div>
                    <Label className="text-[10px] font-bold text-white/80 mb-1 block uppercase tracking-wider">
                      Recipient Mobile Number
                    </Label>
                    <div className="relative">
                      <Input
                        type="tel"
                        placeholder="e.g. 0244123456"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="bg-white/5 border-white/15 text-white rounded-xl h-10 font-mono text-xs pl-9 focus:border-amber-400 focus:ring-amber-400/20"
                      />
                      <Smartphone className="w-4 h-4 text-amber-400 absolute left-3 top-3" />
                    </div>
                  </div>

                  {/* Payment Method Selection */}
                  <div>
                    <Label className="text-[10px] font-bold text-white/80 mb-1 block uppercase tracking-wider">
                      Payment Method
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {user && (
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("wallet")}
                          className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                            paymentMethod === "wallet"
                              ? "border-amber-400 bg-amber-400/10 text-white shadow-md shadow-amber-500/10"
                              : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                          }`}
                        >
                          <Wallet className={`w-4 h-4 shrink-0 ${paymentMethod === "wallet" ? "text-amber-400" : ""}`} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold leading-tight truncate">Wallet</p>
                            {walletBalance !== null && (
                              <p className="text-[9px] text-amber-400 font-mono font-bold mt-0.5 truncate">GH₵ {walletBalance.toFixed(2)}</p>
                            )}
                          </div>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("momo")}
                        className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                          !user ? "col-span-2" : ""
                        } ${
                          paymentMethod === "momo"
                            ? "border-amber-400 bg-amber-400/10 text-white shadow-md shadow-amber-500/10"
                            : "border-white/10 bg-white/5 text-white/50 hover:text-white"
                        }`}
                      >
                        <CreditCard className={`w-4 h-4 shrink-0 ${paymentMethod === "momo" ? "text-amber-400" : ""}`} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold leading-tight truncate">MoMo / Card</p>
                          <p className="text-[9px] text-white/40 mt-0.5 truncate">Instant Payment</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Submit Action Button */}
                  {paymentMethod === "wallet" && user ? (
                    <Button
                      onClick={handleBuyWithWallet}
                      disabled={loading || !phone}
                      className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black h-11 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 gap-1.5 transition-all active:scale-95"
                    >
                      {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Zap className="w-4 h-4 fill-black" /> Buy Now • GH₵ {activePromo.promo_price.toFixed(2)}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleBuyWithMomo}
                      disabled={!phone}
                      className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black h-11 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 gap-1.5 transition-all active:scale-95"
                    >
                      <CreditCard className="w-4 h-4" /> Pay with MoMo • GH₵ {activePromo.promo_price.toFixed(2)}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Cute Small Close Button */}
            <button
              onClick={handleDismiss}
              className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-black/70 hover:bg-black flex items-center justify-center border border-white/20 text-white/80 hover:text-white transition-all z-30"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
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
