import { useState, useEffect } from "react";
import { Gift, Calendar, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const DailyCheckIn = () => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hasCheckedIn, setHasCheckedIn] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (profile?.last_check_in) {
      const lastCheckIn = new Date(profile.last_check_in);
      const today = new Date();
      
      // We MUST use UTC to evaluate the date, otherwise users in UTC+1 will see the button 
      // unlock at 11:00 PM Ghana time, resulting in a database rejection!
      const lastCheckInUTC = `${lastCheckIn.getUTCFullYear()}-${lastCheckIn.getUTCMonth()}-${lastCheckIn.getUTCDate()}`;
      const todayUTC = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
      
      if (lastCheckInUTC === todayUTC) {
        setHasCheckedIn(true);
      }
    }
    setStreak(profile?.check_in_streak || 0);
  }, [profile]);

  const handleCheckIn = async () => {
    if (!user || hasCheckedIn) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("claim_daily_check_in", {
        p_user_id: user.id,
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`Bonus! +${data.points_awarded} SwiftPoints added to your wallet.`);
        setHasCheckedIn(true);
        setStreak(data.streak);
      } else {
        toast.error(data.error || "Check-in failed");
      }
    } catch (err: any) {
      console.error("Check-in error:", err);
      toast.error(err.message || "Failed to check in");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  const filled = hasCheckedIn ? ((streak - 1) % 7) + 1 : streak % 7;

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
          <Gift className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground leading-snug">Daily reward</p>
          <p className="text-xs text-muted-foreground">
            {hasCheckedIn ? "Claimed today. Come back tomorrow." : "Check in to earn SwiftPoints."}
          </p>
        </div>
        <button
          onClick={handleCheckIn}
          disabled={loading || hasCheckedIn}
          className={
            "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition " +
            (hasCheckedIn
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 cursor-default"
              : "bg-primary text-primary-foreground hover:brightness-105 active:scale-[0.98]")
          }
        >
          {loading ? (
            <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : hasCheckedIn ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Claimed
            </>
          ) : (
            <>
              <Calendar className="h-4 w-4" /> Claim
            </>
          )}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5" aria-label={`${streak} day streak`}>
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <div key={day} className="flex flex-col items-center gap-1">
            <span className={"h-1.5 w-full rounded-full " + (day <= filled ? "bg-amber-500" : "bg-muted dark:bg-white/[0.08]")} />
            <span className="text-[10px] text-muted-foreground tabular-nums">D{day}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {streak > 0 ? `${streak}-day streak` : "Start a streak today"}
        {streak > 0 ? " · longer streaks earn bigger bonuses" : ""}
      </p>
    </div>
  );
};

export default DailyCheckIn;
