import { useState, useEffect, useRef } from "react";
import { WifiOff, AlertTriangle, CheckCircle2, X, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useConnectivity } from "@/hooks/useConnectivity";
import { getQueuedTransactions, syncOfflineQueue } from "@/lib/offline-queue";
import { getPendingGuestOrderDraft } from "@/lib/offline-cache";

export const OfflineAlert = () => {
  const { isOnline, quality } = useConnectivity();
  const [showRestored, setShowRestored] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const prevOnline = useRef(isOnline);

  useEffect(() => {
    const refreshQueueCount = async () => {
      const txs = await getQueuedTransactions();
      const pendingTxs = txs.filter(t => t.status === "pending" || t.status === "processing").length;
      const hasDraft = getPendingGuestOrderDraft() ? 1 : 0;
      setQueuedCount(pendingTxs + hasDraft);
    };
    void refreshQueueCount();

    const onSyncStatus = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      setIsSyncingQueue(Boolean(detail?.isSyncing));
    };

    window.addEventListener("offline-queue-changed", refreshQueueCount);
    window.addEventListener("offline-draft-changed", refreshQueueCount);
    window.addEventListener("offline-sync-status-changed", onSyncStatus);
    return () => {
      window.removeEventListener("offline-queue-changed", refreshQueueCount);
      window.removeEventListener("offline-draft-changed", refreshQueueCount);
      window.removeEventListener("offline-sync-status-changed", onSyncStatus);
    };
  }, []);

  // Only show "Back Online" when transitioning from offline → online (not on first mount)
  useEffect(() => {
    if (!prevOnline.current && isOnline) {
      setShowRestored(true);
      void syncOfflineQueue();
      const timer = setTimeout(() => setShowRestored(false), 5000);
      prevOnline.current = true;
      return () => clearTimeout(timer);
    }
    if (!isOnline) {
      setShowRestored(false);
      setDismissed(false);
      prevOnline.current = false;
    }
  }, [isOnline]);

  const showSlowWarning = isOnline && quality === "poor" && !dismissed;
  const showOfflineWarning = !isOnline;

  return (
    <div className="fixed top-16 left-0 right-0 z-[100] pointer-events-none flex flex-col items-center px-4 gap-2">
      <AnimatePresence mode="popLayout">
        {/* Offline Warning */}
        {showOfflineWarning && (
          <motion.div
            initial={{ scale: 0.8, y: -40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="pointer-events-auto bg-red-600/95 text-white py-1.5 px-3.5 rounded-full flex items-center gap-2.5 shadow-lg shadow-red-900/20 border border-red-500/40 backdrop-blur-md"
          >
            <motion.div 
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              className="flex items-center justify-center"
            >
              <WifiOff className="w-3.5 h-3.5" />
            </motion.div>
            <span className="text-xs font-bold tracking-tight">
              {queuedCount > 0
                ? `Offline Mode • ${queuedCount} order${queuedCount > 1 ? "s" : ""} ready to auto-sync`
                : "Offline Mode • Cached bundles active"}
            </span>
          </motion.div>
        )}

        {/* Slow Connection Warning */}
        {showSlowWarning && (
          <motion.div
            initial={{ scale: 0.8, y: -40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: "spring", damping: 18, stiffness: 350 }}
            className="pointer-events-auto bg-amber-500/95 text-black py-1.5 px-3.5 rounded-full flex items-center gap-2.5 shadow-lg shadow-amber-900/20 border border-amber-400/40 backdrop-blur-md"
          >
            <motion.div
              animate={{ rotate: [-6, 6, -6] }}
              transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-black/80" />
            </motion.div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-tight">Slow Connection • Fast Cache Enabled</span>
              <div className="w-px h-2.5 bg-black/20" />
            </div>
            <button 
              onClick={() => setDismissed(true)}
              title="Dismiss warning"
              className="hover:bg-black/10 p-0.5 rounded-full transition-colors flex items-center justify-center"
            >
              <X className="w-3 h-3 text-black/60" />
            </button>
          </motion.div>
        )}

        {/* Back Online / Syncing Confirmation */}
        {(showRestored || isSyncingQueue) && isOnline && !showSlowWarning && (
          <motion.div
            initial={{ scale: 0.8, y: -40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: "spring", damping: 20, stiffness: 400 }}
            className="pointer-events-auto bg-emerald-600/95 text-white py-1.5 px-3.5 rounded-full flex items-center gap-2.5 shadow-lg shadow-emerald-900/20 border border-emerald-500/40 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.1 }}
            >
              {isSyncingQueue ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
            </motion.div>
            <span className="text-xs font-bold tracking-tight">
              {isSyncingQueue ? "Syncing queued orders..." : "Connection Restored"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
