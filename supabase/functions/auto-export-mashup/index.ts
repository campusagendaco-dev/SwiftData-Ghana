import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsAppMessage } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Retrieve current settings
    const { data: settings, error: settingsErr } = await supabase
      .from("system_settings")
      .select("mashup_automation_enabled, mashup_export_threshold, mashup_whatsapp_number")
      .eq("id", 1)
      .maybeSingle();

    if (settingsErr) throw settingsErr;
    if (!settings || !settings.mashup_automation_enabled) {
      return new Response(JSON.stringify({ success: true, message: "Automation is disabled or settings not found." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { mashup_export_threshold: threshold, mashup_whatsapp_number: whatsappNumber } = settings;

    if (!whatsappNumber || whatsappNumber.trim().length === 0) {
      console.warn("Mashup automation enabled but no WhatsApp number configured.");
      return new Response(JSON.stringify({ success: true, message: "No WhatsApp number configured." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Count current pending orders to ensure we meet threshold
    const { count, error: countErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("network", "MTN Mash Up")
      .eq("status", "pending");

    if (countErr) throw countErr;

    const currentCount = count || 0;
    if (currentCount < threshold) {
      console.log(`Current pending count (${currentCount}) is below threshold (${threshold}). Skipping export.`);
      return new Response(JSON.stringify({ success: true, message: `Pending count (${currentCount}) below threshold (${threshold}).` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Atomically select and transition status of pending orders to 'processing'
    console.log(`Transitioning and exporting ${currentCount} pending Mash Up orders...`);
    const { data: updatedOrders, error: updateErr } = await supabase
      .from("orders")
      .update({ 
        status: "processing",
        updated_at: new Date().toISOString()
      })
      .eq("network", "MTN Mash Up")
      .eq("status", "pending")
      .select("customer_phone, package_size");

    if (updateErr) throw updateErr;

    if (!updatedOrders || updatedOrders.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No orders updated/exported." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Format WhatsApp message
    const dateStr = new Date().toLocaleString("en-GH", { 
      timeZone: "UTC",
      day: "2-digit", 
      month: "short", 
      year: "numeric", 
      hour: "2-digit", 
      minute: "2-digit",
      hour12: true 
    });

    let message = `📦 *MTN MASH UP ORDERS EXPORT*\n`;
    message += `*Total Orders:* ${updatedOrders.length}\n`;
    message += `*Exported At:* ${dateStr} (UTC)\n\n`;
    message += `-----------------------------\n`;
    message += `*No. | Recipient | Package Size*\n`;
    message += `-----------------------------\n`;

    updatedOrders.forEach((o, index) => {
      const phone = o.customer_phone || "N/A";
      const size = o.package_size || "N/A";
      message += `${index + 1}. \`${phone}\` - *${size}*\n`;
    });

    message += `-----------------------------\n\n`;
    message += `⚡ _Please process these orders immediately._`;

    // 5. Send message via WaSender API
    console.log(`Sending WhatsApp export message to ${whatsappNumber}...`);
    await sendWhatsAppMessage(whatsappNumber, message);

    return new Response(JSON.stringify({ 
      success: true, 
      exported_count: updatedOrders.length,
      whatsapp_recipient: whatsappNumber
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Mash Up auto-export failed:", err);
    return new Response(JSON.stringify({ success: false, error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
