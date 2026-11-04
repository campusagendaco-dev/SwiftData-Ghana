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
          .eq("user_id", user.id)
          .maybeSingle();

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
    <section className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400 flex items-center justify-center">
            <Gift className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-foreground leading-snug">Refer friends, earn SwiftPoints</h2>
            <p className="text-[12.5px] text-muted-foreground mt-0.5">
              You get <span className="font-semibold text-foreground">200 points (GH₵2.00)</span> when a friend joins and buys their first bundle. They get 100 points too.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <div className="flex items-center h-10 rounded-xl border border-border/80 bg-muted/40 pl-3 pr-1 min-w-0 flex-1 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <span className="text-[12.5px] text-muted-foreground truncate flex-1">{referralLink.replace(/^https?:\/\//, "")}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(referralLink)}
                  aria-label="Copy referral link"
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleWhatsAppShare} className="flex-1 sm:flex-none h-10 px-3.5 rounded-xl bg-[#25D366] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:brightness-95">
                  <Share2 className="h-4 w-4" /> WhatsApp
                </button>
                <button type="button" onClick={handleShare} className="flex-1 sm:flex-none h-10 px-3.5 rounded-xl border border-border text-[13px] font-semibold text-foreground hover:bg-muted dark:border-white/10">
                  More
                </button>
              </div>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 lg:w-64">
          <div className="rounded-xl bg-muted/50 px-3 py-2.5 dark:bg-white/[0.04]">
            <dt className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Friends joined</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{stats.count}</dd>
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2.5 dark:bg-white/[0.04]">
            <dt className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Award className="h-3.5 w-3.5" /> Points earned</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{stats.pointsEarned}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
};

// Internal Badge component if needed, or import from UI
const Badge = ({ children, className, variant }: any) => (
  <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>
    {children}
  </div>
);

export default ReferAndEarn;
