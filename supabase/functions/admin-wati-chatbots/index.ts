import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getWatiChatbots, startWatiChatbot } from "../_shared/whatsapp.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    const action = body.action || "list";

    if (action === "list") {
      const pageNumber = body.page_number || body.pageNumber || 1;
      const pageSize = body.page_size || body.pageSize || 50;

      const data = await getWatiChatbots(pageNumber, pageSize);

      if (!data) {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to fetch chatbots from WATI API. Ensure WATI_TOKEN and WATI_ENDPOINT are set." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          chatbot_list: data.chatbot_list || [],
          page_number: data.page_number || pageNumber,
          page_size: data.page_size || pageSize,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (action === "start") {
      const { target, chatbot_id, chatbotId } = body;
      const targetPhone = target || body.whatsappNumber;
      const selectedBotId = chatbot_id || chatbotId;

      if (!targetPhone || !selectedBotId) {
        return new Response(
          JSON.stringify({ success: false, error: "Both 'target' (recipient phone number) and 'chatbot_id' are required." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      const ok = await startWatiChatbot(targetPhone, selectedBotId);

      if (ok) {
        // Log event
        await supabaseAdmin.from("system_logs").insert({
          level: "info",
          source: "admin_wati_chatbots",
          event: "chatbot.started",
          message: `WATI chatbot '${selectedBotId}' triggered for '${targetPhone}'`,
          data: { target: targetPhone, chatbot_id: selectedBotId },
        });

        return new Response(
          JSON.stringify({ success: true, message: `Chatbot flow '${selectedBotId}' initiated for ${targetPhone}.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, error: "Failed to start chatbot flow via WATI API." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: "Invalid action. Supported actions: 'list', 'start'" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  } catch (err: any) {
    console.error("[Admin WATI Chatbots] Error:", err);
    return new Response(JSON.stringify({ error: err?.message || err }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
