import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms, normalizePhone } from "../_shared/sms.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { phone, action, order_id, amount, package_size, network, agent_id, reason } = body;

    const shortId = order_id ? String(order_id).slice(0, 8).toUpperCase() : "";
    let message = "";

    const rLower = String(reason || "").toLowerCase();
    const isBeneficiaryReason = rLower.includes("beneficiary") ||
      rLower.includes("not on") ||
      rLower.includes("whitelist") ||
      rLower.includes("not added") ||
      rLower.includes("unregistered");

    if (action === "non_beneficiary" || action === "beneficiary_guide" || action === "in_queue" || isBeneficiaryReason) {
      const amtPart = amount ? ` (GHS ${Number(amount || 0).toFixed(2)})` : "";
      message = `SwiftData Notice: Order #${shortId} for ${phone || "recipient"} is IN QUEUE ⏳ for MTN Whitelist Approval${amtPart}.\n\n` +
        `Your bundle will deliver automatically after approval. No action needed!\n` +
        `Track status: https://swiftdatagh.shop/submit-numbers`;
    } else if (action === "refund") {
      const reasonPart = reason ? ` Reason: ${reason}.` : "";
      message = `SwiftData Alert: Order #${shortId} for ${phone || "recipient"} (GHS ${Number(amount || 0).toFixed(2)}) has been refunded to your wallet balance.${reasonPart}`;
    } else if (action === "retry") {
      message = `SwiftData Alert: Order #${shortId} for ${phone || "recipient"} (${network || ""} ${package_size || ""}) has been verified & re-submitted for delivery.`;
    } else if (action === "fulfilled") {
      message = `SwiftData Alert: Order #${shortId} for ${phone || "recipient"} (${network || ""} ${package_size || ""}) has been delivered successfully!`;
    } else {
      message = `SwiftData Alert: Order #${shortId} for ${phone || "recipient"} status updated.`;
    }

    let sentToRecipient = false;
    let sentToAgent = false;

    // Use "SwiftUpdate" Sender ID specifically for queued/non-beneficiary guide SMS
    const customSenderId = (action === "non_beneficiary" || action === "beneficiary_guide" || action === "in_queue" || isBeneficiaryReason) ? "SwiftUpdate" : undefined;

    // Send SMS to recipient phone number if available
    if (phone) {
      const res = await sendPaymentSms(supabaseAdmin, phone, "custom", { message, senderId: customSenderId }, agent_id);
      if (res) sentToRecipient = true;
    }

    // Send SMS to Agent profile if agent_id provided
    if (agent_id) {
      const { data: prof } = await supabaseAdmin.from("profiles").select("phone").eq("user_id", agent_id).maybeSingle();
      if (prof?.phone && normalizePhone(prof.phone) !== normalizePhone(phone)) {
        const res = await sendPaymentSms(supabaseAdmin, prof.phone, "custom", { message, senderId: customSenderId }, agent_id);
        if (res) sentToAgent = true;
      }
    }

    return new Response(JSON.stringify({ success: true, message, sentToRecipient, sentToAgent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[send-order-sms] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
