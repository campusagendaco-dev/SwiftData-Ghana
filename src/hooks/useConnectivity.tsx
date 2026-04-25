import { useState, useEffect } from "react";

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
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (connection) {
      connection.addEventListener("change", updateStatus);
    }

    updateStatus();

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
      if (connection) {
        connection.removeEventListener("change", updateStatus);
      }
    };
  }, []);

  return { isOnline, quality, effectiveType };
};
