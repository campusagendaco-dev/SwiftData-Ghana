import { supabase } from "@/integrations/supabase/client";

/**
 * Safely removes a Supabase Realtime channel without triggering browser console WebSocket closure race warnings.
 * Allows pending WebSocket handshakes to finish establishing before calling teardown methods.
 */
export function safeRemoveChannel(channel: ReturnType<typeof supabase.channel> | null | undefined) {
  if (!channel) return;
  setTimeout(() => {
    try {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    } catch {
      // Ignore websocket teardown timing warnings
    }
  }, 300);
}
