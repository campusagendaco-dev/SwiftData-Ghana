import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  Smartphone, Send, Play, Pause, Square, RefreshCw,
  CheckCircle2, AlertTriangle, Trash2, ShieldCheck,
  Sparkles, Globe, Laptop, Terminal, ExternalLink
} from "lucide-react";

interface PushStats {
  total: number;
  recent30d: number;
  recent7d: number;
  loading: boolean;
}

interface BatchLog {
  id: string;
  timestamp: string;
  offset: number;
  sent: number;
  cleaned: number;
  failed: number;
  durationMs: number;
  message: string;
}

const PRESET_TEMPLATES = [
  {
    label: "⚡ Flash Data Sale",
    title: "⚡ Flash Data Sale Active! 🚀",
    body: "Super discounts on all MTN & Telecel data bundles active right now! Purchase high-speed bundles at absolute wholesale rates.",
    url: "/dashboard",
  },
  {
    label: "🚀 Fast Delivery Online",
    title: "⚡ High-Speed Delivery Restored! 📲",
    body: "All network lines (MTN, Telecel, AirtelTigo) are fully active and delivering in under 2 minutes. Tap to buy now!",
    url: "/dashboard",
  },
  {
    label: "🎓 WASSCE 2026 Checkers",
    title: "🎓 WASSCE 2026 Results Checkers In Stock! 📜",
    body: "WASSCE 2026 Results are officially out! Checkers are now in stock at wholesale rates. Check your results instantly.",
    url: "/dashboard",
  },
  {
    label: "💰 Top Up & Sell",
    title: "💰 Top Up Your SwiftData Wallet",
    body: "Keep your sales running smoothly without interruption. Top up your wallet now and enjoy zero-downtime orders!",
    url: "/dashboard",
  },
];

export function BulkPushBroadcaster({ triggerClassName }: { triggerClassName?: string }) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<PushStats>({
    total: 0,
    recent30d: 0,
    recent7d: 0,
    loading: false,
  });

  // Form State
  const [title, setTitle] = useState("⚡ High-Speed Delivery Restored! 📲");
  const [body, setBody] = useState("All network lines (MTN, Telecel, AirtelTigo) are fully active and delivering in under 2 minutes. Tap to buy now!");
  const [actionUrl, setActionUrl] = useState("/dashboard");
  const [batchSize, setBatchSize] = useState<number>(50);
  const [delayMs, setDelayMs] = useState<number>(400);

  // Engine Execution State
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [cleanedCount, setCleanedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [logs, setLogs] = useState<BatchLog[]>([]);

  // Execution control refs
  const abortControllerRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  const fetchStats = useCallback(async () => {
    setStats((prev) => ({ ...prev, loading: true }));
    try {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [totalRes, r30Res, r7Res] = await Promise.all([
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).gte("created_at", d30),
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).gte("created_at", d7),
      ]);

      setStats({
        total: totalRes.count || 0,
        recent30d: r30Res.count || 0,
        recent7d: r7Res.count || 0,
        loading: false,
      });
    } catch (e) {
      console.warn("[BulkPush] Stats fetch error:", e);
      setStats((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen, fetchStats]);

  // Keep ref synchronized
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Test push to admin's own current device
  const handleTestSelf = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Fields required", description: "Please enter title and message.", variant: "destructive" });
      return;
    }
    try {
      toast({ title: "Sending test push...", description: "Dispatched to your registered session." });
      const { data, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          user_id: user?.id,
          title: `[TEST] ${title.trim()}`,
          body: body.trim(),
          url: actionUrl.trim() || "/dashboard",
        },
      });

      if (error || (data && !data.success)) {
        toast({
          title: "Test Push Failed",
          description: error?.message || data?.error || "Could not deliver push to your device.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Test Push Delivered! 📲",
          description: `Device acknowledged test notification (${data.sent} device).`,
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Start Batched Full Broadcast
  const handleStartBroadcast = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Missing fields", description: "Title and message are required.", variant: "destructive" });
      return;
    }

    if (stats.total === 0) {
      toast({ title: "No subscribers", description: "0 registered push devices found.", variant: "destructive" });
      return;
    }

    abortControllerRef.current = false;
    isPausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);
    setProcessedCount(0);
    setSentCount(0);
    setCleanedCount(0);
    setFailedCount(0);
    setLogs([]);

    toast({
      title: "Bulk Push Broadcast Started 🚀",
      description: `Iterating across ${stats.total.toLocaleString()} subscribers in batches of ${batchSize}...`,
    });

    let currentOffset = 0;
    let localSent = 0;
    let localCleaned = 0;
    let localFailed = 0;

    try {
      while (!abortControllerRef.current) {
        // Handle Pause state
        while (isPausedRef.current && !abortControllerRef.current) {
          await new Promise((r) => setTimeout(r, 400));
        }

        if (abortControllerRef.current) break;

        const startTime = Date.now();
        const { data, error } = await supabase.functions.invoke("send-push-notification", {
          body: {
            broadcast: true,
            offset: currentOffset,
            limit: batchSize,
            title: title.trim(),
            body: body.trim(),
            url: actionUrl.trim() || "/dashboard",
          },
        });

        const duration = Date.now() - startTime;

        if (error) {
          console.error(`[BulkPush] Batch at offset ${currentOffset} failed:`, error);
          localFailed += batchSize;
          setFailedCount(localFailed);

          setLogs((prev) => [
            {
              id: `${Date.now()}-${currentOffset}`,
              timestamp: new Date().toLocaleTimeString(),
              offset: currentOffset,
              sent: 0,
              cleaned: 0,
              failed: batchSize,
              durationMs: duration,
              message: `Batch failed: ${error.message || "Network error"}`,
            },
            ...prev.slice(0, 49),
          ]);

          // Move to next chunk to prevent infinite loop on transient error
          currentOffset += batchSize;
          setProcessedCount(currentOffset);
        } else {
          const sent = Number(data?.sent || 0);
          const cleaned = Number(data?.cleaned || 0);
          const devicesInBatch = Number(data?.devices || 0);
          const hasMore = Boolean(data?.has_more);

          localSent += sent;
          localCleaned += cleaned;
          setSentCount(localSent);
          setCleanedCount(localCleaned);

          const stepCount = devicesInBatch > 0 ? devicesInBatch : batchSize;
          currentOffset += stepCount;
          setProcessedCount(Math.min(stats.total, currentOffset));

          setLogs((prev) => [
            {
              id: `${Date.now()}-${currentOffset}`,
              timestamp: new Date().toLocaleTimeString(),
              offset: currentOffset - stepCount,
              sent,
              cleaned,
              failed: Math.max(0, devicesInBatch - sent - cleaned),
              durationMs: duration,
              message: `Delivered to ${sent} devices (${cleaned} stale cleaned)`,
            },
            ...prev.slice(0, 49),
          ]);

          if (!hasMore || devicesInBatch === 0) {
            console.log("[BulkPush] Completed all subscription slices.");
            break;
          }
        }

        // Pacing delay to avoid saturating browser workers & Google/Apple push gateways
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      // Log in system logs
      await (supabase as any).from("system_logs").insert({
        level: "info",
        source: "admin",
        event: "broadcast.web_push_bulk",
        message: `Bulk Web Push completed: ${localSent} delivered, ${localCleaned} cleaned out of ${stats.total} devices`,
        agent_id: user?.id,
        data: {
          title,
          body,
          url: actionUrl,
          total_devices: stats.total,
          delivered: localSent,
          cleaned: localCleaned,
        },
      });

      toast({
        title: "Bulk Web Push Complete! 🎉",
        description: `Successfully delivered ${localSent.toLocaleString()} notifications. Cleaned ${localCleaned} expired tokens.`,
      });

      fetchStats();
    } catch (err: any) {
      console.error("[BulkPush] Execution error:", err);
      toast({ title: "Broadcast Encountered Issue", description: err.message, variant: "destructive" });
    } finally {
      setIsRunning(false);
      setIsPaused(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current = true;
    setIsRunning(false);
    setIsPaused(false);
    toast({ title: "Broadcast Stopped", description: "Remaining batches cancelled." });
  };

  const progressPercent = stats.total > 0 ? Math.min(100, Math.round((processedCount / stats.total) * 100)) : 0;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "gap-2 font-bold border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300",
            triggerClassName
          )}
        >
          <Smartphone className="w-4 h-4 animate-pulse text-cyan-400" />
          <span>Blast 6.4k+ Web Push Devices</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl bg-[#0c0e14] border-white/10 text-white p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black text-white flex items-center gap-2">
                  Bulk Web Push Broadcaster
                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">
                    Auto-Pruning Active
                  </Badge>
                </DialogTitle>
                <p className="text-white/40 text-xs">
                  Delivers lock-screen alerts across Android, iPhone (PWA), and PC browsers in safe batched slices.
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={fetchStats}
              disabled={stats.loading}
              className="text-white/40 hover:text-white"
            >
              <RefreshCw className={cn("w-4 h-4", stats.loading && "animate-spin")} />
            </Button>
          </div>
        </DialogHeader>

        {/* Audience Breakdown Card */}
        <div className="grid grid-cols-3 gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Total Subscriptions</p>
            <p className="text-xl font-black text-cyan-400">
              {stats.loading ? "..." : stats.total.toLocaleString()}
            </p>
            <p className="text-[10px] text-white/30">Stored in database</p>
          </div>
          <div className="space-y-0.5 border-l border-white/10 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Fresh (30 Days)</p>
            <p className="text-xl font-black text-emerald-400">
              {stats.loading ? "..." : stats.recent30d.toLocaleString()}
            </p>
            <p className="text-[10px] text-emerald-400/60">~95% live delivery</p>
          </div>
          <div className="space-y-0.5 border-l border-white/10 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Real Deliverable</p>
            <p className="text-xl font-black text-amber-400">
              {stats.loading ? "..." : `~${Math.round(stats.total * 0.7).toLocaleString()}`}
            </p>
            <p className="text-[10px] text-amber-400/60">Active lock-screens</p>
          </div>
        </div>

        {/* Template Chips */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Quick Template Shortcuts</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_TEMPLATES.map((tmpl, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setTitle(tmpl.title);
                  setBody(tmpl.body);
                  setActionUrl(tmpl.url);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-white/70 hover:bg-cyan-500/10 hover:border-cyan-500/30 hover:text-cyan-300 transition-all"
              >
                {tmpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Compose Form */}
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-white/40">Notification Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. ⚡ Flash Weekend Data Sale! 🚀"
              disabled={isRunning}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-9 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-white/40">Notification Message</label>
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write announcement body..."
              disabled={isRunning}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-white/20 resize-none focus:outline-none focus:border-cyan-500/40"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Target Link</label>
              <Input
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                placeholder="/dashboard"
                disabled={isRunning}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/20 h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Batch Size</label>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 h-8 text-xs text-white focus:outline-none"
              >
                <option value={25} className="bg-[#0c0e14]">25 devices/batch (Safest)</option>
                <option value={50} className="bg-[#0c0e14]">50 devices/batch (Recommended)</option>
                <option value={75} className="bg-[#0c0e14]">75 devices/batch</option>
                <option value={100} className="bg-[#0c0e14]">100 devices/batch (Fastest)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Pacing Delay</label>
              <select
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 h-8 text-xs text-white focus:outline-none"
              >
                <option value={200} className="bg-[#0c0e14]">200ms (High speed)</option>
                <option value={400} className="bg-[#0c0e14]">400ms (Balanced)</option>
                <option value={800} className="bg-[#0c0e14]">800ms (Gentle)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Live Execution Progress */}
        {isRunning && (
          <div className="space-y-3 p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/30">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Broadcasting in Progress... ({progressPercent}%)
              </span>
              <span className="text-white/60 font-mono text-[11px]">
                {processedCount.toLocaleString()} / {stats.total.toLocaleString()} processed
              </span>
            </div>

            <Progress value={progressPercent} className="h-2 bg-white/10 [&>div]:bg-cyan-400" />

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] text-emerald-400 font-bold">Delivered</p>
                <p className="text-base font-black text-emerald-400 font-mono">{sentCount.toLocaleString()}</p>
              </div>
              <div className="p-2 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] text-amber-400 font-bold">Stale Cleaned</p>
                <p className="text-base font-black text-amber-400 font-mono">{cleanedCount.toLocaleString()}</p>
              </div>
              <div className="p-2 rounded-xl bg-black/40 border border-white/5">
                <p className="text-[10px] text-white/40 font-bold">Remaining</p>
                <p className="text-base font-black text-white/60 font-mono">
                  {Math.max(0, stats.total - processedCount).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Live Log Terminal */}
        {logs.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-white/40 font-bold uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3 h-3 text-cyan-400" />
                Live Batch Activity
              </span>
              <span>{logs.length} batches logged</span>
            </div>
            <div className="p-2.5 rounded-xl bg-black/70 border border-white/10 font-mono text-[10px] max-h-32 overflow-y-auto space-y-1 text-white/70">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between">
                  <span className="text-white/30">[{log.timestamp}] Offset {log.offset}:</span>
                  <span className={log.sent > 0 ? "text-emerald-400" : "text-amber-400"}>{log.message}</span>
                  <span className="text-white/20">{log.durationMs}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestSelf}
            disabled={isRunning}
            className="border-white/10 text-white/70 hover:bg-white/5 text-xs gap-1.5"
          >
            <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
            Test On My Phone
          </Button>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setIsPaused(!isPaused)}
                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs gap-1.5"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  {isPaused ? "Resume" : "Pause"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleStop}
                  className="text-xs gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop Broadcast
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleStartBroadcast}
                disabled={!title.trim() || !body.trim() || stats.total === 0}
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs gap-2 px-5"
              >
                <Send className="w-3.5 h-3.5" />
                Blast All {stats.total.toLocaleString()} Devices Now
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
