import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { X, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Info, Clock } from "lucide-react";

interface LogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  event: string;
  message: string;
  data: Record<string, unknown> | null;
  duration_ms: number | null;
  resolved: boolean;
}

interface Props {
  orderId: string;
  onClose: () => void;
}

const LEVEL_ICON = {
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
};

const LEVEL_COLOR = {
  info: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  warn: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  error: "text-red-400 border-red-400/30 bg-red-400/10",
};

const LEVEL_LINE = {
  info: "bg-blue-400/30",
  warn: "bg-amber-400/30",
  error: "bg-red-500/50",
};

const SOURCE_SHORT: Record<string, string> = {
  "verify-payment": "verify",
  "datahub-webhook": "webhook",
  "wallet-buy-data": "wallet",
  "cron-auto-retry": "cron",
  "system": "system",
};

export default function OrderJourneyModal({ orderId, onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      setLogs([]);
      setLoading(false);
      return;
    }
    const fetchJourney = async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("system_logs")
        .select("*")
        .eq("order_id", orderId)
        .order("ts", { ascending: true });
      setLogs((data as LogEntry[]) || []);
      setLoading(false);
    };
    fetchJourney();
  }, [orderId]);

  const totalDuration = logs.length >= 2
    ? new Date(logs[logs.length - 1].ts).getTime() - new Date(logs[0].ts).getTime()
    : null;

  const hasError = logs.some((l) => l.level === "error");
  const isFulfilled = logs.some((l) => l.event === "order.fulfilled");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#0d140d] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/5 shrink-0">
          <div>
            <h2 className="text-white font-black text-lg">Order Journey</h2>
            <p className="text-white/30 text-xs font-mono mt-1 truncate max-w-xs">{orderId}</p>
            <div className="flex items-center gap-3 mt-2">
              {isFulfilled && (
                <span className="flex items-center gap-1 text-green-400 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Fulfilled
                </span>
              )}
              {hasError && !isFulfilled && (
                <span className="flex items-center gap-1 text-red-400 text-xs font-bold">
                  <XCircle className="w-3.5 h-3.5" /> Has Errors
                </span>
              )}
              {totalDuration != null && (
                <span className="flex items-center gap-1 text-white/30 text-xs">
                  <Clock className="w-3 h-3" /> {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`} total
                </span>
              )}
              <span className="text-white/20 text-xs">{logs.length} events</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-white/5 text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-5 space-y-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-6 h-6 text-white/20 animate-spin" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Info className="w-8 h-8 text-white/10" />
              <p className="text-white/30 text-sm">No logs recorded for this order</p>
              <p className="text-white/20 text-xs">Logs are captured from the next order onward</p>
            </div>
          ) : (
            logs.map((log, idx) => {
              const Icon = LEVEL_ICON[log.level] ?? Info;
              const isLast = idx === logs.length - 1;
              const isExpanded = expandedId === log.id;
              const hasData = log.data && Object.keys(log.data).length > 0;

              return (
                <div key={log.id} className="flex gap-4">
                  {/* Spine */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className={cn("w-8 h-8 rounded-full border flex items-center justify-center shrink-0", LEVEL_COLOR[log.level])}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    {!isLast && <div className={cn("w-0.5 flex-1 my-1 min-h-[24px]", LEVEL_LINE[log.level])} />}
                  </div>

                  {/* Content */}
                  <div className={cn("flex-1 min-w-0 pb-5", isLast && "pb-0")}>
                    <button
                      type="button"
                      onClick={() => hasData && setExpandedId(isExpanded ? null : log.id)}
                      className="w-full text-left group"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white/20 text-[11px] font-mono tabular-nums shrink-0">
                          {format(new Date(log.ts), "HH:mm:ss.SSS")}
                        </span>
                        <span className="text-primary/60 text-[11px] font-bold shrink-0">{log.event}</span>
                        <span className="text-white/20 text-[10px] bg-white/5 px-1.5 rounded shrink-0">
                          {SOURCE_SHORT[log.source] ?? log.source}
                        </span>
                        {log.duration_ms != null && (
                          <span className="text-white/20 text-[10px] shrink-0">{log.duration_ms}ms</span>
                        )}
                      </div>
                      <p className={cn(
                        "text-sm mt-1 leading-snug",
                        log.level === "error" ? "text-red-300/80" : log.level === "warn" ? "text-amber-300/70" : "text-white/60"
                      )}>
                        {log.message}
                      </p>
                    </button>

                    {isExpanded && hasData && (
                      <pre className="mt-2 bg-black/40 rounded-lg p-3 text-[10px] text-green-400/70 font-mono overflow-x-auto max-h-48 scrollbar-thin scrollbar-thumb-white/10 leading-relaxed">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
