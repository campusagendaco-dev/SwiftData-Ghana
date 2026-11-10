import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Trophy,
  Gamepad2,
  Coins,
  Gift,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

export default function AdminChallengeArena() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<any>({
    arena_enabled: true,
    free_data_rewards_enabled: true,
    daily_free_data_limit: 15,
    free_data_package_size: "1GB",
    free_data_win_streak_required: 2,
    house_commission_percent: 10,
    min_stake_ghs: 2,
    max_stake_ghs: 200,
    enabled_games: { oware: true, ludo: true, dame: true },
  });

  const [challenges, setChallenges] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [todayFreeCount, setTodayFreeCount] = useState(0);
  const [closingRooms, setClosingRooms] = useState(false);
  const [manualRefunds, setManualRefunds] = useState<any[]>([]);

  const fetchAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "admin_get_lobby" },
      });
      if (!error && data?.success) {
        if (data.settings) setSettings(data.settings);
        if (Array.isArray(data.challenges)) setChallenges(data.challenges);
        if (Array.isArray(data.recent_claims)) setClaims(data.recent_claims);
        if (typeof data.today_free_data_claimed === "number") {
          setTodayFreeCount(data.today_free_data_claimed);
        }
      }
    } catch (err) {
      console.error("Failed to load Admin Challenge Arena data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  const handleCloseStakedRooms = async () => {
    setClosingRooms(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "admin_close_staked_rooms" },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Could not close staked rooms");
      }
      setManualRefunds(data.manual_refunds || []);
      toast({
        title: `${data.closed} staked room(s) closed`,
        description: data.failed?.length
          ? `Could not refund: ${data.failed.join(", ")}`
          : "Wallet stakes were returned automatically.",
        variant: data.failed?.length ? "destructive" : undefined,
      });
      fetchAdminData();
    } catch (err: any) {
      toast({ title: "Could not close rooms", description: err.message, variant: "destructive" });
    } finally {
      setClosingRooms(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: {
          action: "admin_update_settings",
          ...settings,
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to save arena settings");
      }
      setSettings(data.settings);
      toast({
        title: "Arena Settings Saved! ✅",
        description: "Open Challenge & Ghanaian Traditional Games configuration updated.",
      });
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateClaimStatus = async (claimId: string, status: "fulfilled" | "rejected") => {
    try {
      const { data, error } = await supabase.functions.invoke("challenge-arena", {
        body: { action: "admin_update_claim", claim_id: claimId, status },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || "Failed to update claim");
      }
      toast({ title: "Reward Claim Updated", description: data.message });
      fetchAdminData();
    } catch (err: any) {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    }
  };

  const completedPaidChallenges = challenges.filter(
    (c) => c.status === "completed" && Number(c.stake_amount || 0) > 0
  );
  const totalHouseEarned = completedPaidChallenges.reduce(
    (sum, c) => sum + Number(c.house_fee || 0),
    0
  );
  const totalStakedVolume = challenges.reduce(
    (sum, c) => sum + Number(c.stake_amount || 0) * (c.mode === "p2p" && c.opponent_name ? 2 : 1),
    0
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <Gamepad2 className="w-7 h-7 text-amber-400" />
            Admin Open Challenge &amp; Games Arena
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Manage Oware, Ghana Ludo, Dame &amp; Ampe challenges, house commission %, and Free Data winner rewards.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={fetchAdminData}
          className="h-10 rounded-xl border-white/15 bg-white/5 text-xs font-bold gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900/80 border-amber-500/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Total Challenges</p>
              <p className="text-2xl font-black text-white font-mono mt-1">{challenges.length}</p>
            </div>
            <Trophy className="w-8 h-8 text-amber-400" />
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-emerald-500/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Total Staked Volume</p>
              <p className="text-2xl font-black text-emerald-400 font-mono mt-1">
                GH₵ {totalStakedVolume.toFixed(2)}
              </p>
            </div>
            <Coins className="w-8 h-8 text-emerald-400" />
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-sky-500/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Admin House Profit</p>
              <p className="text-2xl font-black text-sky-400 font-mono mt-1">
                GH₵ {totalHouseEarned.toFixed(2)}
              </p>
            </div>
            <Coins className="w-8 h-8 text-sky-400" />
          </CardContent>
        </Card>

        <Card className="bg-slate-900/80 border-purple-500/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Free Data Today</p>
              <p className="text-2xl font-black text-purple-400 font-mono mt-1">
                {todayFreeCount} / {settings.daily_free_data_limit || 15}
              </p>
            </div>
            <Gift className="w-8 h-8 text-purple-400" />
          </CardContent>
        </Card>
      </div>

      {/* Arena Configuration Card */}
      <Card className="border-amber-500/30 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base font-black text-white">
            Arena Rules, Stakes &amp; Free Data Configuration
          </CardTitle>
          <CardDescription>
            Control stake limits, house commission percentage, and daily free data bundle rewards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 flex items-center justify-between">
              <div>
                <Label className="text-xs font-bold text-white">Enable Challenge Arena</Label>
                <p className="text-[10px] text-muted-foreground">Master switch for all games</p>
              </div>
              <Switch
                checked={Boolean(settings.arena_enabled)}
                onCheckedChange={(c) => setSettings({ ...settings, arena_enabled: c })}
              />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-white/10 flex items-center justify-between">
              <div>
                <Label className="text-xs font-bold text-white">Free Data Challenges</Label>
                <p className="text-[10px] text-muted-foreground">Allow free data wins vs AI</p>
              </div>
              <Switch
                checked={Boolean(settings.free_data_rewards_enabled)}
                onCheckedChange={(c) => setSettings({ ...settings, free_data_rewards_enabled: c })}
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">House Commission (%)</Label>
              <Input
                type="number"
                value={settings.house_commission_percent}
                onChange={(e) =>
                  setSettings({ ...settings, house_commission_percent: Number(e.target.value) })
                }
                className="h-10 bg-slate-950 border-white/15 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Max Free Data Wins / Day</Label>
              <Input
                type="number"
                value={settings.daily_free_data_limit}
                onChange={(e) =>
                  setSettings({ ...settings, daily_free_data_limit: Number(e.target.value) })
                }
                className="h-10 bg-slate-950 border-white/15 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Free Data Reward Size</Label>
              <Input
                value={settings.free_data_package_size}
                onChange={(e) =>
                  setSettings({ ...settings, free_data_package_size: e.target.value })
                }
                placeholder="e.g. 500MB or 1GB"
                className="h-10 bg-slate-950 border-white/15 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Min Stake (GH₵)</Label>
              <Input
                type="number"
                value={settings.min_stake_ghs}
                onChange={(e) => setSettings({ ...settings, min_stake_ghs: Number(e.target.value) })}
                className="h-10 bg-slate-950 border-white/15 font-mono"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Max Stake (GH₵)</Label>
              <Input
                type="number"
                value={settings.max_stake_ghs}
                onChange={(e) => setSettings({ ...settings, max_stake_ghs: Number(e.target.value) })}
                className="h-10 bg-slate-950 border-white/15 font-mono"
              />
            </div>
          </div>

          <div className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">Cash stakes are paused</p>
            <p className="text-xs text-muted-foreground">
              New staked matches are blocked. Close any open staked rooms to return wallet stakes. Mobile Money stakes need a manual refund in Paystack.
            </p>
            <Button type="button" variant="outline" onClick={handleCloseStakedRooms} disabled={closingRooms}>
              {closingRooms ? "Closing rooms..." : "Close open staked rooms"}
            </Button>
            {manualRefunds.length > 0 && (
              <ul className="text-xs text-foreground space-y-1">
                {manualRefunds.map((room) => (
                  <li key={room.room_code}>
                    Refund GH₵{Number(room.amount).toFixed(2)} for room #{room.room_code}: {room.phone || "no phone"}, ref {room.paystack_ref || "none"}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            onClick={handleSaveSettings}
            disabled={saving}
            className="h-10 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Arena Settings
          </Button>
        </CardContent>
      </Card>

      {/* Winner Reward Claims Queue */}
      <Card className="border-white/10 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base font-black text-white">
            Winner Data Bundle &amp; Cash Reward Claims ({claims.length})
          </CardTitle>
          <CardDescription>
            Review Free Data and Data Bundle rewards won by gamers in the Challenge Arena.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4">No reward claims recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-white">{claim.winner_name}</span>
                      <Badge variant="outline" className="font-mono text-amber-300 border-amber-500/40">
                        {claim.winner_phone} ({claim.network})
                      </Badge>
                      <Badge
                        className={
                          claim.status === "fulfilled" || claim.status === "credited"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : claim.status === "rejected"
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        }
                      >
                        {claim.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {claim.reward_type === "wallet_cash"
                        ? `Wallet Cash Prize: GH₵ ${Number(claim.cash_amount || 0).toFixed(2)}`
                        : `Data Bundle Prize: ${claim.network} ${claim.data_package_size || "1GB"}`}{" "}
                      · {claim.notes}
                    </p>
                  </div>

                  {claim.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleUpdateClaimStatus(claim.id, "fulfilled")}
                        className="h-8 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Mark Fulfilled
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleUpdateClaimStatus(claim.id, "rejected")}
                        className="h-8 rounded-lg text-xs gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

