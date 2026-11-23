import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { boxState, type BoxState, type MysteryProgress } from "@/lib/mysteryBox";

export type MysteryCampaign = {
  id: string;
  title: string;
  image_url: string | null;
  orders_per_box: number;
  max_boxes_per_user: number;
  bullets: string[];
  ends_at: string;
};

export type OpenResult =
  | { success: true; prize_label: string; order_id: string }
  | { success: false; error: string; message: string };

const OPEN_FAILED: Extract<OpenResult, { success: false }> = {
  success: false,
  error: "open_failed",
  message: "We couldn't open your box right now. Please try again.",
};

async function fetchMysteryBox(): Promise<{ campaign: MysteryCampaign; progress: MysteryProgress } | null> {
  const nowIso = new Date().toISOString();
  const { data: row, error } = await supabase
    .from("mystery_box_campaigns")
    .select("id, title, image_url, orders_per_box, max_boxes_per_user, bullets, ends_at")
    .eq("is_active", true)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !row) return null;

  const { data: progressRows, error: progressError } = await supabase.rpc("mystery_box_progress", {
    p_campaign_id: row.id,
  });
  const progress = Array.isArray(progressRows) ? progressRows[0] : progressRows;
  if (progressError || !progress) return null;

  const campaign: MysteryCampaign = {
    ...row,
    bullets: Array.isArray(row.bullets) ? row.bullets.filter((b: unknown) => typeof b === "string" && b.trim()) : [],
  };
  return { campaign, progress: progress as MysteryProgress };
}

export function useMysteryBox(): {
  campaign: MysteryCampaign | null;
  progress: MysteryProgress | null;
  state: BoxState | null;
  isLoading: boolean;
  open: (phone: string) => Promise<OpenResult>;
} {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["mystery-box", user?.id];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: fetchMysteryBox,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    retry: false,
  });

  const campaign = data?.campaign ?? null;
  const progress = data?.progress ?? null;

  const open = useCallback(
    async (phone: string): Promise<OpenResult> => {
      if (!campaign) return OPEN_FAILED;
      try {
        const { data: res, error } = await supabase.functions.invoke("open-mystery-box", {
          body: { campaign_id: campaign.id, phone },
        });
        if (error || !res) return OPEN_FAILED;
        return res.success
          ? { success: true, prize_label: String(res.prize_label), order_id: String(res.order_id) }
          : { success: false, error: String(res.error || "open_failed"), message: String(res.message || OPEN_FAILED.message) };
      } catch {
        return OPEN_FAILED;
      } finally {
        queryClient.invalidateQueries({ queryKey: ["mystery-box", user?.id] });
      }
    },
    [campaign, queryClient, user?.id],
  );

  return {
    campaign,
    progress,
    state: campaign && progress ? boxState(progress, campaign.max_boxes_per_user) : null,
    isLoading,
    open,
  };
}
