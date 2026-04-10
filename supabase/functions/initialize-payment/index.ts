import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY is not configured");
    return new Response(JSON.stringify({ error: "Paystack not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Validate key type — must be a secret key
  if (PAYSTACK_SECRET_KEY.startsWith("pk_")) {
    console.error("PAYSTACK_SECRET_KEY contains a public key instead of secret key");
    return new Response(JSON.stringify({ error: "Invalid Paystack key configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("holiday_mode_enabled, holiday_message, disable_ordering")
      .eq("id", 1)
      .maybeSingle();

    if (settings?.disable_ordering) {
      return new Response(JSON.stringify({
        error: settings.holiday_message || "Ordering is currently disabled. Please try again later.",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const email = typeof payload?.email === "string" ? payload.email.trim() : "";
    const amount = Number(payload?.amount);
    const reference = typeof payload?.reference === "string" ? payload.reference.trim() : "";
    const callback_url = payload?.callback_url;
    const metadata = payload?.metadata || {};

    if (!email || !reference || !Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side order creation — don't trust frontend to create orders
    const orderType = metadata.order_type || "data";
    const agentId = metadata.agent_id || "00000000-0000-0000-0000-000000000000";

    // Check if order already exists (idempotency)
    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("id", reference)
      .maybeSingle();

    if (!existingOrder) {
      const orderRow: Record<string, unknown> = {
        id: reference,
        agent_id: agentId,
        order_type: orderType,
        amount,
        profit: 0,
        status: "pending",
      };
      if (metadata.customer_phone) orderRow.customer_phone = metadata.customer_phone;
      if (metadata.network) orderRow.network = metadata.network;
      if (metadata.package_size) orderRow.package_size = metadata.package_size;
      // AFA fields
      if (metadata.afa_full_name) orderRow.afa_full_name = metadata.afa_full_name;
      if (metadata.afa_ghana_card) orderRow.afa_ghana_card = metadata.afa_ghana_card;
      if (metadata.afa_occupation) orderRow.afa_occupation = metadata.afa_occupation;
      if (metadata.afa_email) orderRow.afa_email = metadata.afa_email;
      if (metadata.afa_residence) orderRow.afa_residence = metadata.afa_residence;
      if (metadata.afa_date_of_birth) orderRow.afa_date_of_birth = metadata.afa_date_of_birth;

      const { error: insertError } = await supabaseAdmin.from("orders").insert(orderRow);
      if (insertError) {
        console.error("Failed to create order:", insertError);
        return new Response(JSON.stringify({ error: "Failed to create order" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log("Order created server-side:", reference, orderType);
    }

    const amountInPesewas = Math.round(amount * 100);
    console.log("Initializing payment:", { email, amount, amountInPesewas, reference });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInPesewas,
        reference,
        callback_url,
        metadata,
        currency: "GHS",
      }),
    });

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const textResponse = await response.text();
      console.error("Paystack returned non-JSON:", textResponse.substring(0, 500));
      return new Response(JSON.stringify({ error: "Paystack returned an invalid response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("Paystack response:", JSON.stringify(data));

    if (!response.ok || !data.status) {
      console.error("Paystack initialization failed", {
        status: response.status,
        statusText: response.statusText,
        paystackMessage: data?.message,
      });
      return new Response(JSON.stringify({ error: data.message || "Payment initialization failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Payment init error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
