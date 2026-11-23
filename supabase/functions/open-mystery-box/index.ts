import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { mysteryBoxError, toLocalGhPhone } from "../_shared/mystery_box.ts";

// Opens the caller's next Mystery Box: the DB function checks eligibility, picks the prize,
// lowers stock and writes the open record + zero-cost prize order in one transaction.
// Delivery is then handed to verify-payment, which refuses prize orders without an open record.

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: "server_misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authError } = token
      ? await supabase.auth.getUser(token)
      : { data: { user: null }, error: new Error("missing token") };
    const user = authData?.user;
    if (authError || !user) {
      return json({ success: false, error: "unauthorized", message: "Please sign in to open your box." });
    }

    const { data: sysSettings } = await supabase
      .from("v_system_settings_with_secrets").select("disable_ordering, holiday_message").eq("id", 1).maybeSingle();
    if (sysSettings?.disable_ordering) {
      return json({
        success: false,
        error: "ordering_disabled",
        message: sysSettings.holiday_message || "Ordering is paused right now. Your box will be waiting for you.",
      });
    }

    const payload = await req.json().catch(() => null);
    const campaignId = typeof payload?.campaign_id === "string" ? payload.campaign_id : "";
    const phone = toLocalGhPhone(typeof payload?.phone === "string" ? payload.phone : "");
    if (!phone) return json({ success: false, ...mysteryBoxError("invalid_phone") });
    if (!campaignId) return json({ success: false, ...mysteryBoxError("campaign_closed") });

    const { data: rows, error: openError } = await supabase.rpc("mystery_box_open", {
      p_campaign_id: campaignId,
      p_user_id: user.id,
      p_phone: phone,
    });
    const opened = Array.isArray(rows) ? rows[0] : rows;
    if (openError || !opened?.order_id) {
      if (openError) console.error("[open-mystery-box] open failed:", openError.message);
      return json({ success: false, ...mysteryBoxError(openError?.message) });
    }

    // The box is opened and recorded. Delivery problems are retried by admins, so they don't undo the win.
    let status = "processing";
    try {
      const fulfillRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ reference: opened.order_id }),
      });
      const fulfillData = (await fulfillRes.json().catch(() => null)) || {};
      if (fulfillData.status === "fulfilled") status = "fulfilled";
      if (fulfillData.status === "fulfillment_failed") {
        console.error("[open-mystery-box] delivery failed:", opened.order_id, fulfillData.error || fulfillData.reason);
      }
    } catch (e) {
      console.error("[open-mystery-box] delivery trigger error:", opened.order_id, e);
    }

    return json({
      success: true,
      prize_label: opened.prize_label,
      order_id: opened.order_id,
      box_number: opened.box_number,
      status,
    });
  } catch (err) {
    console.error("[open-mystery-box] error:", err);
    return json({ success: false, ...mysteryBoxError(null) });
  }
});
