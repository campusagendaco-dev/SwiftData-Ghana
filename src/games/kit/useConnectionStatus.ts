import { useEffect, useState } from "react";

export type ConnectionStatus = "online" | "offline";

const current = (): ConnectionStatus =>
  typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(current);

  useEffect(() => {
    const goOnline = () => setStatus("online");
    const goOffline = () => setStatus("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return status;
}
