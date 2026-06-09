import { useState, useEffect } from "react";
import { syncOfflineQueue } from "@/lib/offline-queue";
import { toast } from "@/hooks/use-toast";

export type ConnectionQuality = "excellent" | "good" | "fair" | "poor" | "offline";

interface NetworkInformation extends EventTarget {
  readonly downlink: number;
  readonly effectiveType: "slow-2g" | "2g" | "3g" | "4g";
  readonly rtt: number;
  readonly saveData: boolean;
  onchange: EventListener;
}

export const useConnectivity = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [quality, setQuality] = useState<ConnectionQuality>("excellent");
  const [effectiveType, setEffectiveType] = useState<string | null>(null);

  useEffect(() => {
    const updateStatus = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      
      if (!online) {
        setQuality("offline");
        return;
      }

      // Check for Network Information API support
      const nav = navigator as any;
      const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

      if (connection) {
        setEffectiveType(connection.effectiveType);
        
        const type = connection.effectiveType;
        if (type === "slow-2g" || type === "2g") {
          setQuality("poor");
        } else if (type === "3g") {
          setQuality("fair");
        } else if (connection.downlink < 1) {
          setQuality("fair");
        } else {
          setQuality("excellent");
        }
      }

      // Trigger sync fallback when back online
      if (online) {
        syncOfflineQueue().catch((err) => console.error("[useConnectivity] Sync error:", err));
      }
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "OFFLINE_TRANSACTION_SYNCED") {
        const { network, packageSize, phone } = event.data;
        
        // Play success sound if module is loaded
        import("@/lib/sound")
          .then((m) => m.playSuccessSound())
          .catch((err) => console.warn("Failed to play success sound:", err));
          
        toast({
          title: "Offline Sync Complete! 📶",
          description: `Queued order of ${network} ${packageSize} for ${phone} was successfully completed.`,
        });

        // Broadcast to rest of application
        window.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: event.data }));
      }
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (connection) {
      connection.addEventListener("change", updateStatus);
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    }

    updateStatus();

    // Trigger initial check/sync on boot
    if (navigator.onLine) {
      syncOfflineQueue().catch((err) => console.error("[useConnectivity] Initial boot sync error:", err));
    }

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      if (connection) {
        connection.removeEventListener("change", updateStatus);
      }
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      }
    };
  }, []);

  return { isOnline, quality, effectiveType };
};

