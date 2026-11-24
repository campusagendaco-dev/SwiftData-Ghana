import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox } from "@/hooks/useMysteryBox";
import { boxState, rememberSeen, shouldPopUp } from "@/lib/mysteryBox";
import { MysteryBoxModal } from "@/components/MysteryBoxModal";

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Mounted app-wide for signed-in customers. Watches the customer's own orders and, whenever one
 * is delivered (today's count goes up), pops up the Mystery Box on whatever page they're on.
 */
export function MysteryBoxWatcher() {
  const { user, isAdmin } = useAuth();
  const { campaign, progress, refresh } = useMysteryBox();
  const [open, setOpen] = useState(false);
  const userId = user?.id;
  const active = Boolean(userId) && !isAdmin;
  const hasCampaign = Boolean(campaign);

  // Refresh progress the moment one of this customer's orders is delivered.
  useEffect(() => {
    if (!active || !hasCampaign) return;
    const channel = supabase
      // Unique name per mount: realtime-js reuses a same-named channel that may still be leaving.
      .channel(`mystery-box-orders-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `agent_id=eq.${userId}` },
        (payload: { new?: { status?: string } }) => {
          const status = payload.new?.status;
          if (status === "fulfilled" || status === "completed") refresh();
        },
      )
      .subscribe();
    return () => safeRemoveChannel(channel);
  }, [active, hasCampaign, userId, refresh]);

  // Pop up when today's count is higher than the customer last saw (also covers orders
  // delivered while they were away).
  const campaignId = campaign?.id;
  const day = progress?.today;
  const count = progress?.qualifying_orders ?? 0;
  // Once today's boxes are all opened, more orders shouldn't keep interrupting with "come back tomorrow".
  const doneToday = Boolean(campaign && progress && boxState(progress, campaign.boxes_per_day) === "done");

  // A different account on the same device starts with the popup closed.
  useEffect(() => {
    setOpen(false);
  }, [userId]);

  useEffect(() => {
    if (!active || !userId || !campaignId || !day) return;
    const store = localStore();
    if (shouldPopUp(userId, campaignId, day, count, store)) {
      rememberSeen(userId, campaignId, day, count, store);
      if (!doneToday) setOpen(true);
    }
  }, [active, userId, campaignId, day, count, doneToday]);

  if (!active || !campaign || !progress) return null;
  return <MysteryBoxModal open={open} onOpenChange={setOpen} />;
}

export default MysteryBoxWatcher;
