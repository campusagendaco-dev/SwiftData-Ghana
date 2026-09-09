import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";

type TableName = string;

interface RealtimeOptions {
  /** Tables to subscribe to. Triggers refetch on any change. */
  tables: TableName[];
  /** Called whenever any subscribed table changes. Receives isSilent = true on background updates. */
  onRefresh: (isSilent?: boolean) => void;
  /** Optional debounce ms (default 1500) to consolidate rapid multi-step status updates */
  debounceMs?: number;
  /** Optional filter per table, e.g. { wallets: "agent_id=eq.abc" } */
  filters?: Record<string, string>;
}

/** Poll interval (ms) — safety net for mobile where WebSocket dies in background */
const POLL_INTERVAL_MS = 45_000;

/**
 * Subscribes to one or more Supabase tables and calls onRefresh
 * (debounced) on any INSERT / UPDATE / DELETE.
 *
 * Prevents UI flicker by notifying consumers when an update is a silent background sync.
 * Gated by tab visibility to avoid CPU and battery thrashing on background tabs.
 */
export function useRealtimeRefresh({
  tables,
  onRefresh,
  debounceMs = 1500,
  filters = {},
}: RealtimeOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onRefreshRef = useRef(onRefresh);

  // Keep the ref current so the poll closure always calls the latest callback
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  const trigger = (isSilent = true) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Only execute if tab is currently visible
      if (document.visibilityState === "visible") {
        onRefreshRef.current(isSilent);
      }
    }, debounceMs);
  };

  useEffect(() => {
    const filtersStr = JSON.stringify(filters);

    // ── Realtime subscriptions ──────────────────────────────────────────────
    const channels = tables.map((table) => {
      const channelName = `realtime-sync-${table}-${Math.random().toString(36).slice(2, 9)}`;
      const filter = filters[table];

      const ch = supabase
        .channel(channelName)
        .on(
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table,
            ...(filter ? { filter } : {}),
          },
          () => trigger(true),
        )
        .subscribe();

      return ch;
    });

    // ── Polling fallback (catches missed events if mobile OS killed WS) ──
    pollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        onRefreshRef.current(true);
      }
    }, POLL_INTERVAL_MS);

    // ── Re-fetch immediately when tab regains focus (app foregrounded) ──────
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        trigger(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      channels.forEach((ch) => safeRemoveChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), JSON.stringify(filters), debounceMs]);
}
