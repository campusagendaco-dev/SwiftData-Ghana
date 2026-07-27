import { useMemo, useState } from "react";
import { Loader2, Search, Zap, Activity, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveStoreDomain } from "@/lib/app-base-url";
import LastMtnOrderWidget from "@/components/LastMtnOrderWidget";

interface PhoneOrderTrackerProps {
  title?: string;
  subtitle?: string;
  className?: string;
  defaultPhone?: string;
}

const PhoneOrderTracker = ({
  title = "Track Your Order",
  subtitle = "Instant real-time tracking for your data bundles.",
  className = "",
  defaultPhone,
}: PhoneOrderTrackerProps) => {
  const [phone, setPhone] = useState(defaultPhone || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/\D+/g, "");
  const isPhone = digitsOnly.length >= 9 && digitsOnly.length <= 15 && !/[a-zA-Z]/.test(trimmed);
  const isReference = !isPhone && trimmed.length >= 6;
  const isValid = isPhone || isReference;

  const handleTrack = async () => {
    if (!isValid) return;
    setError("");
    setLoading(true);

    if (isReference) {
      const isStorePath = window.location.pathname.startsWith("/store/");
      let redirectUrl = `/order-status?reference=${encodeURIComponent(trimmed)}`;
      if (isStorePath) {
        const parts = window.location.pathname.split("/");
        const slug = parts[2];
        if (slug) {
          redirectUrl = `/store/${slug}/order-status?reference=${encodeURIComponent(trimmed)}`;
        }
      }
      window.location.href = redirectUrl;
      return;
    }

    const sanitizedPhone = digitsOnly;
    try {
      const { data, error: invError } = await supabase.functions.invoke("verify-payment", {
        body: { phone: sanitizedPhone },
      });

      if (invError || !data || data.error) {
        setError(data?.error || "No recent orders found for this number.");
        return;
      }

      // Redirect to the multi-order tracking portal
      const activeDomain = getActiveStoreDomain();
      const isStorePath = window.location.pathname.startsWith("/store/");
      let redirectUrl = `/my-orders?phone=${sanitizedPhone}`;

      if (activeDomain) {
        redirectUrl = `/my-orders?phone=${sanitizedPhone}`;
      } else if (isStorePath) {
        const parts = window.location.pathname.split("/");
        const slug = parts[2];
        if (slug) {
          redirectUrl = `/store/${slug}/my-orders?phone=${sanitizedPhone}`;
        }
      }
      window.location.href = redirectUrl;
    } catch (err) {
      setError("Unable to sync with network. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && isValid) handleTrack(); };

  return (
    <div className={`relative group ${className}`}>
      {/* Premium Glow Effect */}
      <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-amber-500/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
      
      <div className="relative rounded-3xl border border-white/8 bg-[#0A0A0C]/80 backdrop-blur-xl overflow-hidden shadow-2xl">
        <div className="p-6 bg-white/[0.02]">
            <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div className="flex items-center gap-2.5 sm:gap-3.5">
                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0 shadow-lg shadow-amber-400/5">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg tracking-tight text-white">{title}</h3>
                  <p className="text-[10px] sm:text-xs font-medium text-white/40">{subtitle}</p>
                </div>
              </div>
              <LastMtnOrderWidget variant="pill" className="scale-90 sm:scale-100 origin-right self-start xs:self-center shrink-0" />
            </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Phone Number or Order Reference (e.g. 0541234567 or ORD-...)"
                className="h-12 pl-10 bg-white/[0.03] border-white/10 text-white placeholder:text-white/20 rounded-2xl focus-visible:ring-amber-400/30 transition-all text-xs sm:text-sm"
                type="text"
              />
            </div>
            <Button 
              onClick={handleTrack} 
              disabled={!isValid || loading} 
              className="h-12 px-8 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              <span className="ml-2">Track Now</span>
            </Button>
          </div>

          {error && (
            <div className="mt-4 relative overflow-hidden rounded-xl border border-red-500/20 bg-red-500/[0.03] p-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                <p className="text-[10px] text-white/40 font-medium">{error}</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="bg-white/[0.01] px-6 py-3 flex items-center justify-center gap-2 border-t border-white/5">
           <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
           <span className="text-[8px] font-black uppercase tracking-[0.2em] text-white/20">Secure Backend Bridge Active</span>
        </div>
      </div>
    </div>
  );
};

export default PhoneOrderTracker;
