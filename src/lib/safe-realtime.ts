import { supabase } from "@/integrations/supabase/client";

/**
 * Safely removes a Supabase Realtime channel without leaving orphaned WebSocket subscriptions.
 */
export function safeRemoveChannel(channel: ReturnType<typeof supabase.channel> | null | undefined) {
  if (!channel) return;
  try {
    channel.unsubscribe();
    supabase.removeChannel(channel);
  } catch {
    // Ignore websocket teardown timing warnings
  }
}
