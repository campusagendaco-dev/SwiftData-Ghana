import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Gift, Loader2, CheckCircle2, Wifi, X } from "lucide-react";

const NETWORK_COLORS: Record<string, string> = {
  MTN: "#FFC107",
  Telecel: "#E53935",
  AirtelTigo: "#6366f1",
};

const FreeDataClaimBanner = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [campaign, setCampaign] = useState<{
    enabled: boolean;
    network: string;
    packageSize: string;
    maxClaims: number;
  } | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const checkCampaignAndClaim = async () => {
      const [settingsRes, claimRes] = await Promise.all([
        supabase
          .from("public_system_settings")
          .select("free_data_enabled, free_data_network, free_data_package_size, free_data_max_claims, free_data_claims_count")
          .eq("id", 1)
          .maybeSingle(),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", user.id)
          .eq("order_type" as any, "free_data_claim"),
      ]);

      const data = settingsRes.data;
      if (!settingsRes.error && data && data.free_data_enabled) {
        setCampaign({
          enabled: true,
          network: data.free_data_network || "MTN",
          packageSize: data.free_data_package_size || "1GB",
          maxClaims: Number(data.free_data_max_claims || 100),
        });
      }

      if ((claimRes.count ?? 0) > 0) {
        setAlreadyClaimed(true);
      }

      setLoading(false);
    };

    checkCampaignAndClaim();
  }, [user]);

  const handleClaim = async () => {
    if (!user || !campaign || !profile?.phone) {
      toast({ title: "Phone number required", description: "Update your phone in Account Settings to claim.", variant: "destructive" });
      return;
    }

    setClaiming(true);

    // Create a free_data_claim order — admin fulfills manually
    const { error } = await supabase.from("orders").insert({
      agent_id: user.id,
      order_type: "free_data_claim" as any,
      network: campaign.network,
      package_size: campaign.packageSize,
      customer_phone: profile.phone,
      amount: 0,
      profit: 0,
      status: "pending",
    } as any);

    if (error) {
      toast({ title: "Claim failed", description: error.message, variant: "destructive" });
    } else {
      setClaimed(true);
      setAlreadyClaimed(true);
      toast({
        title: "Claimed! Your free data is being processed.",
        description: `${campaign.packageSize} ${campaign.network} data will be sent to ${profile.phone} shortly.`,
      });
    }
    setClaiming(false);
  };

  if (loading || !campaign || !campaign.enabled || dismissed) return null;

  const accentColor = NETWORK_COLORS[campaign.network] || "#22c55e";

  if (alreadyClaimed || claimed) {
    return (
      <div
        className="relative rounded-2xl p-4 mb-4 border flex items-center gap-4"
        style={{ background: `${accentColor}10`, borderColor: `${accentColor}30` }}
      >
        <CheckCircle2 className="w-6 h-6 shrink-0" style={{ color: accentColor }} />
        <div>
          <p className="font-bold text-white text-sm">Free data claimed!</p>
          <p className="text-xs text-white/50">
            Your {campaign.packageSize} {campaign.network} bundle is being processed and will arrive shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-2xl overflow-hidden mb-4 border"
      style={{ borderColor: `${accentColor}30` }}
    >
      {/* Animated gradient top bar */}
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88, ${accentColor})`, backgroundSize: "200%", animation: "shimmer 2s linear infinite" }} />

      <div className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4" style={{ background: `linear-gradient(135deg, ${accentColor}12, transparent)` }}>
        {/* Icon */}
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}40` }}>
          <Gift className="w-6 h-6" style={{ color: accentColor }} />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full text-black" style={{ background: accentColor }}>
              LIMITED TIME
            </span>
            <span className="text-[10px] text-white/40 flex items-center gap-1"><Wifi className="w-3 h-3" /> {campaign.network}</span>
          </div>
          <p className="font-black text-white text-base leading-tight">
            Claim your FREE {campaign.packageSize} data bundle!
          </p>
          <p className="text-xs text-white/50 mt-0.5">One claim per account. No payment required.</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleClaim}
            disabled={claiming}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-sm text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-60"
            style={{ background: accentColor }}
          >
            {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
            {claiming ? "Claiming..." : "Claim Now"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
      `}</style>
    </div>
  );
};

export default FreeDataClaimBanner;
