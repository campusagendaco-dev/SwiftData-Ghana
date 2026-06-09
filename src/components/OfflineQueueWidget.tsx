import { useState, useEffect } from "react";
import { 
  WifiOff, RefreshCw, Trash2, Clock, AlertTriangle, Loader2 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  getQueuedTransactions, deleteQueuedTransaction, syncOfflineQueue, QueuedTransaction 
} from "@/lib/offline-queue";
import { toast } from "sonner";

export const OfflineQueueWidget = () => {
  const [queue, setQueue] = useState<QueuedTransaction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadQueue = async () => {
    const txs = await getQueuedTransactions();
    // Sort so most recent is first
    setQueue(txs.sort((a, b) => b.timestamp - a.timestamp));
  };

  useEffect(() => {
    loadQueue();

    const handleQueueChange = () => {
      loadQueue();
    };

    const handleSyncStatus = (e: Event) => {
      const customEvent = e as CustomEvent<{ isSyncing: boolean }>;
      if (customEvent.detail) {
        setIsSyncing(customEvent.detail.isSyncing);
      }
    };

    window.addEventListener("offline-queue-changed", handleQueueChange);
    window.addEventListener("offline-sync-status-changed", handleSyncStatus);
    window.addEventListener("offline-sync-complete", handleQueueChange);

    return () => {
      window.removeEventListener("offline-queue-changed", handleQueueChange);
      window.removeEventListener("offline-sync-status-changed", handleSyncStatus);
      window.removeEventListener("offline-sync-complete", handleQueueChange);
    };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteQueuedTransaction(id);
      toast.success("Queued transaction removed");
    } catch (err) {
      toast.error("Failed to remove transaction");
    }
  };

  const handleManualRetry = async () => {
    if (!navigator.onLine) {
      toast.error("You are still offline. Reconnect to retry syncing.", {
        icon: <WifiOff className="w-4 h-4 text-red-500" />
      });
      return;
    }
    setIsSyncing(true);
    try {
      await syncOfflineQueue();
      toast.success("Synchronization process completed");
    } catch (err) {
      toast.error("Sync process encountered errors");
    } finally {
      setIsSyncing(false);
    }
  };

  if (queue.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-transparent backdrop-blur-md p-5 my-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500">
            <WifiOff className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
              Offline Queue ({queue.length})
            </h3>
            <p className="text-[10px] text-amber-400 font-medium uppercase tracking-wider">
              Pending Internet Connectivity
            </p>
          </div>
        </div>
        <button
          onClick={handleManualRetry}
          disabled={isSyncing}
          className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/20 text-black font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition-all border-none cursor-pointer"
        >
          {isSyncing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      <div className="space-y-2.5 max-h-[220px] overflow-y-auto scrollbar-none pr-1">
        <AnimatePresence mode="popLayout">
          {queue.map((tx) => (
            <motion.div
              key={tx.id}
              layout
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white font-mono uppercase tracking-wider">
                    {tx.network} {tx.packageSize}
                  </span>
                  <div className="w-1 h-1 bg-white/20 rounded-full" />
                  <span className="text-white/60 font-semibold">{tx.phone}</span>
                </div>
                
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-amber-400 font-bold font-mono">
                    GH₵{(tx.amount || 0).toFixed(2)}
                  </span>
                  <div className="w-1 h-1 bg-white/10 rounded-full" />
                  <span className="text-white/30 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {tx.error && (
                    <>
                      <div className="w-1 h-1 bg-white/10 rounded-full" />
                      <span className="text-red-400 font-semibold flex items-center gap-0.5 truncate max-w-[150px]" title={tx.error}>
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {tx.error}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <div className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-black uppercase text-white/50 tracking-wider">
                  {tx.status === "processing" ? "Syncing" : tx.status === "failed" ? "Failed" : "Queued"}
                </div>
                <button
                  onClick={() => handleDelete(tx.id)}
                  title="Remove from queue"
                  className="p-1.5 rounded-lg border border-white/5 hover:border-red-500/30 bg-white/5 hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
