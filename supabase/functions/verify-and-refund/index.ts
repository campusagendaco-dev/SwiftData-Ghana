import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 0. Identify the caller — this endpoint has no per-order ownership check
    // otherwise, which would let any authenticated user refund ANY order by
    // guessing/leaking an order_id (IDOR).
    const authHeader = req.headers.get("Authorization");
    const callerToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!callerToken) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized: missing session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user: callerUser }, error: callerErr } = await supabaseAdmin.auth.getUser(callerToken);
    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized: invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { order_id } = await req.json();

    if (!order_id) {
      return new Response(JSON.stringify({ success: false, error: "Order ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch exact order from Database on Server-Side
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (fetchErr || !order) {
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1b. Ownership check: only the order's own agent, or an admin, may act on it.
    if (order.agent_id !== callerUser.id) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerUser.id)
        .eq("role", "admin")
        .limit(1);
      if (!roles || roles.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden: this order does not belong to you" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. SERVER-SIDE CHECK 1: Already Fulfilled / Completed
    if (order.status === "fulfilled" || order.status === "completed") {
      return new Response(JSON.stringify({
        success: false,
        error: "Server Verification Failed: Order was already fulfilled by carrier/provider. Cannot refund."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. SERVER-SIDE CHECK 2: Already Refunded
    if (order.status === "refunded" || order.auto_refunded) {
      return new Response(JSON.stringify({
        success: true,
        message: "Order was already refunded to wallet balance.",
        alreadyRefunded: true
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. SERVER-SIDE CHECK 3: If processing and already received by an API provider, block refund
    if (order.status === "processing") {
      const hasProviderRef = order.provider_order_id && 
        order.provider_order_id !== "" && 
        order.provider_order_id !== "failed_api_call" && 
        order.provider_order_id !== "timeout";

      if (hasProviderRef || order.provider_id) {
        return new Response(JSON.stringify({
          success: false,
          error: "Order has already been submitted and received by the API provider. Cannot refund an active processing order."
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[verify-and-refund] Order ${order_id} is processing without provider reference. Running server-side provider verification first...`);
      const { data: verifyRes } = await supabaseAdmin.functions.invoke("verify-payment", {
        body: { reference: order_id, order_id: order_id, force: true }
      });

      if (verifyRes?.status === "fulfilled" || verifyRes?.status === "completed") {
        return new Response(JSON.stringify({
          success: false,
          error: "Server Verification Failed: Provider confirmed order was DELIVERED. Order marked as fulfilled instead of refunding."
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 5. SERVER-SIDE EXECUTION: Execute refund_failed_order RPC on Database
    const { data: refundSuccess, error: rpcErr } = await supabaseAdmin.rpc("refund_failed_order", {
      p_order_id: order_id
    });

    if (rpcErr || !refundSuccess) {
      return new Response(JSON.stringify({
        success: false,
        error: rpcErr?.message || "Order is ineligible for server refund (e.g. topup/activation fee or non-wallet payment)."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. TRIGGER SMS DISPATCH AFTER SUCCESSFUL SERVER REFUND
    try {
      await supabaseAdmin.functions.invoke("send-order-sms", {
        body: {
          action: "refund",
          phone: order.customer_phone,
          order_id: order.id,
          amount: order.amount,
          agent_id: order.agent_id
        }
      });
    } catch (smsErr) {
      console.error("[verify-and-refund] SMS dispatch warning:", smsErr);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Server Verification Passed: GH₵ ${Number(order.amount).toFixed(2)} refunded to wallet balance.`
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[verify-and-refund] Exception:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
