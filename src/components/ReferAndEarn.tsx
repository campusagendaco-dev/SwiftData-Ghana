import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, Users, Gift, Share2, Award } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ReferAndEarn = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [referralCode, setReferralCode] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ count: 0, pointsEarned: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchReferralInfo = async () => {
      try {
        // Fetch profile to get referral code
        const { data: profileData } = await supabase
          .from("profiles")
          .select("referral_code")
          .eq("id", user.id)
          .single();

        if (profileData?.referral_code) {
          setReferralCode(profileData.referral_code);
        }

        // Fetch referral stats (count of people referred by this user)
        const { count, error: countError } = await supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("referred_by", user.id);

        if (!countError) {
          setStats(prev => ({ ...prev, count: count || 0 }));
        }

        // Points earned from referrals (this is an estimate from the logic)
        // In a real production app, we'd have a separate 'points_history' table
        setStats(prev => ({ ...prev, pointsEarned: (count || 0) * 200 }));

      } catch (err) {
        console.error("Error fetching referral info:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchReferralInfo();
  }, [user]);

  const referralLink = `${window.location.origin}/auth?ref=${referralCode}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: "Link Copied!",
      description: "Share this link with your friends to start earning.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join SwiftData Ghana',
          text: `Use my code ${referralCode} to get a bonus on your first data bundle!`,
          url: referralLink,
        });
      } catch (err) {
        console.log("Share cancelled or failed", err);
      }
    } else {
      copyToClipboard(referralLink);
    }
  };

  const handleWhatsAppShare = () => {
    const text = `Hey! I'm using SwiftData Ghana to buy cheap data bundles. Sign up with my link and get a GHS 1.00 bonus on your first purchase! 🚀🇬🇭\n\n${referralLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  if (loading) return null;

  return (
    <Card className="overflow-hidden border-amber-500/20 bg-amber-500/[0.02] relative group">
      {/* Decorative background icon */}
      <div className="absolute top-[-20px] right-[-20px] opacity-[0.03] group-hover:opacity-[0.05] transition-opacity rotate-12">
        <Users className="w-40 h-40 text-amber-500" />
      </div>

      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Gift className="w-4 h-4 text-amber-500" />
          </div>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 px-2 py-0 text-[10px] uppercase font-black tracking-widest">
            Growth Program
          </Badge>
        </div>
        <CardTitle className="text-xl font-black">Refer & Earn Points</CardTitle>
        <CardDescription className="text-xs max-w-sm">
          Get <span className="font-bold text-amber-500">200 SwiftPoints</span> (GHS 2.00) for every friend who joins and buys their first bundle.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          <div className="relative w-full">
            <Input 
              readOnly 
              value={referralLink} 
              className="bg-background/50 border-white/10 pr-10 text-xs font-medium truncate h-11 rounded-xl w-full"
            />
            <button 
              onClick={() => copyToClipboard(referralLink)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button 
              onClick={handleWhatsAppShare}
              className="h-11 rounded-xl bg-[#25D366] hover:bg-[#25D366]/90 text-white font-bold"
            >
              <Share2 className="w-4 h-4 mr-2" /> WhatsApp
            </Button>
            <Button 
              onClick={handleShare}
              variant="outline"
              className="h-11 rounded-xl border-white/10 hover:bg-white/5 font-bold"
            >
              More Options
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              <Users className="w-3 h-3" /> Friends Joined
            </div>
            <p className="text-lg font-black text-white">{stats.count}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              <Award className="w-3 h-3" /> Points Earned
            </div>
            <p className="text-lg font-black text-amber-400">{stats.pointsEarned}</p>
          </div>
        </div>

        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Referee also gets <span className="text-white font-bold">100 points</span> as a welcome gift!</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Internal Badge component if needed, or import from UI
const Badge = ({ children, className, variant }: any) => (
  <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>
    {children}
  </div>
);

export default ReferAndEarn;
