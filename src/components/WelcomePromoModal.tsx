import { useState, useEffect } from "react";
import { X, Gift, Copy, Check, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const WelcomePromoModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promoData, setPromoData] = useState<{ code: string; discount: number } | null>(null);

  useEffect(() => {
    const fetchActivePromo = async () => {
      const hasSeen = localStorage.getItem("welcome_promo_seen");
      if (hasSeen) return;

      // Check if welcome promo is enabled in system settings
      const { data: settings } = await supabase
        .from("public_system_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      const isEnabled = settings ? (settings as any).welcome_promo_enabled !== false : true;
      if (!isEnabled) return;

      const { data } = await supabase
        .from("promo_codes")
        .select("code, discount_percentage")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setPromoData({ code: data.code, discount: Number(data.discount_percentage) });
        
        // Trigger modal appearance after 15s since there is an active code
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 15000);
        
        return () => clearTimeout(timer);
      }
    };

    fetchActivePromo();
  }, []);

  const close = () => {
    setIsOpen(false);
    localStorage.setItem("welcome_promo_seen", "true");
  };

  const copyCode = () => {
    if (!promoData) return;
    navigator.clipboard.writeText(promoData.code);
    setCopied(true);
    toast.success("Promo code copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen || !promoData) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-12 md:pt-20 bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-md bg-[#0a0e0a] border border-amber-500/20 rounded-3xl p-6 overflow-hidden shadow-2xl animate-in zoom-in-95 slide-in-from-top-10 duration-500">
        {/* Background Accents */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />
        
        <button 
          onClick={close}
          className="absolute top-4 right-4 w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white/70 hover:text-white border border-white/10"
          title="Close"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center pt-4 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mx-auto mb-4">
            <Gift className="w-8 h-8 text-amber-400 animate-bounce" />
          </div>
          
          <h2 className="text-2xl font-black text-white mb-2 tracking-tight">Special Welcome Bonus! 🎁</h2>
          <p className="text-sm text-white/60 mb-6">Get an instant {promoData.discount}% discount on your very first data purchase today.</p>
          
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between mb-6 group hover:border-amber-400/40 transition-colors">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-0.5">Your Code</p>
              <p className="text-xl font-black text-white tracking-wider">{promoData.code}</p>
            </div>
            <button 
              onClick={copyCode}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs transition-all active:scale-95 shadow-lg"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy Code"}
            </button>
          </div>

          <button
            onClick={close}
            className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-white font-bold text-sm transition-all"
          >
            <Zap className="w-4 h-4 text-amber-400" /> Use It Now
          </button>
        </div>
      </div>
    </div>
  );
};
