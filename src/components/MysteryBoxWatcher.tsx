import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { safeRemoveChannel } from "@/lib/safe-realtime";
import { useAuth } from "@/hooks/useAuth";
import { useMysteryBox } from "@/hooks/useMysteryBox";
import { rememberSeen, shouldPopUp } from "@/lib/mysteryBox";
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
      .channel(`mystery-box-orders-${userId}`)
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
  useEffect(() => {
    if (!active || !campaignId || !day) return;
    const store = localStore();
    if (shouldPopUp(campaignId, day, count, store)) {
      rememberSeen(campaignId, day, count, store);
      setOpen(true);
    }
  }, [active, campaignId, day, count]);

  if (!active || !campaign || !progress) return null;
  return <MysteryBoxModal open={open} onOpenChange={setOpen} />;
}

export default MysteryBoxWatcher;
