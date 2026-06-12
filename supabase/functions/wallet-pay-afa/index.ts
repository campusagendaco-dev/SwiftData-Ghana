import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";
import { log } from "../_shared/logger.ts";

function normalizeRecipient(phone: string): string {
  const digits = (phone || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return digits;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200, headers: corsHeaders });

    const payload = await req.json().catch(() => null);
    if (!payload) return new Response(JSON.stringify({ error: "Invalid request payload" }), { status: 200, headers: corsHeaders });

    const {
      customer_phone,
      fullName,
      ghanaCard,
      occupation,
      email,
      residence,
      dateOfBirth,
      reference
    } = payload;

    if (!customer_phone || !fullName || !ghanaCard || !occupation || !residence || !dateOfBirth) {
      return new Response(JSON.stringify({ error: "Missing required registration fields" }), { status: 200, headers: corsHeaders });
    }

    // Maintenance check
    const { data: sysSettings } = await supabaseAdmin
      .from("v_system_settings_with_secrets").select("maintenance_mode, maintenance_message").eq("id", 1).maybeSingle();
    if (sysSettings?.maintenance_mode) {
      return new Response(JSON.stringify({
        error: sysSettings.maintenance_message || "System is under maintenance. Please try again shortly."
      }), { status: 200, headers: corsHeaders });
    }

    // Resolve AFA Wholesale Price
    const { data: afaSetting } = await supabaseAdmin
      .from("global_package_settings")
      .select("agent_price, public_price")
      .eq("network", "AFA")
      .eq("package_size", "BUNDLE")
      .maybeSingle();

    const price = Number(afaSetting?.agent_price ?? afaSetting?.public_price ?? 15.00);

    // Fetch agent profile
    const { data: agentProfile } = await supabaseAdmin
      .from("profiles")
      .select("is_sub_agent, parent_agent_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const parentAgentId = agentProfile?.is_sub_agent ? (agentProfile?.parent_agent_id ?? null) : null;
    const normalizedPhone = normalizeRecipient(customer_phone);

    // Anti-Duplicate check
    const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const { data: duplicateOrder } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("agent_id", user.id)
      .eq("customer_phone", normalizedPhone)
      .eq("network", "AFA")
      .eq("package_size", "BUNDLE")
      .in("status", ["paid", "processing", "fulfilled", "completed"])
      .gte("created_at", oneMinuteAgo)
      .limit(1)
      .maybeSingle();

    if (duplicateOrder) {
      return new Response(JSON.stringify({ error: "Duplicate order detected. Please wait 60 seconds before retrying." }), {
        status: 200,
        headers: corsHeaders
      });
    }

    // Atomic Debit
    console.log(`[wallet-pay-afa] Debiting GHS ${price} from agent ${user.id}`);
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet", {
      p_agent_id: user.id,
      p_amount: price,
    });

    if (debitError || !debitResult?.success) {
      const debitErrMsg = debitResult?.error || "Insufficient balance";
      return new Response(JSON.stringify({ error: debitErrMsg }), { status: 200, headers: corsHeaders });
    }

    const orderId = reference || crypto.randomUUID();

    // Insert order with paid status
    const { error: insertError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      agent_id: user.id,
      customer_phone: normalizedPhone,
      network: "AFA",
      package_size: "BUNDLE",
      amount: price,
      payment_method: "wallet",
      status: "paid",
      parent_agent_id: parentAgentId,
      parent_profit: 0,
      profit: 0,
      afa_full_name: fullName,
      afa_ghana_card: ghanaCard,
      afa_occupation: occupation,
      afa_email: email || null,
      afa_residence: residence,
      afa_date_of_birth: dateOfBirth
    });

    if (insertError) {
      console.error("[wallet-pay-afa] Insert failed:", insertError);
      await supabaseAdmin.rpc("credit_wallet", { p_agent_id: user.id, p_amount: price });
      return new Response(JSON.stringify({ error: "Failed to record the order" }), { status: 200, headers: corsHeaders });
    }

    // Trigger SMS
    sendPaymentSms(supabaseAdmin, customer_phone, "payment_success", {
      phone: customer_phone,
      package: "AFA Registration",
      amount: price
    }, user.id).catch(e => console.error("[SMS-ERROR-AFA]", e));

    console.log(`[wallet-pay-afa] Created AFA registration order: ${orderId} for ${normalizedPhone}`);

    return new Response(JSON.stringify({
      success: true,
      order_id: orderId,
      status: "paid"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[wallet-pay-afa] CRITICAL ERROR:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal server error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
