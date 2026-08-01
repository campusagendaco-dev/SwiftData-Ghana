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

    // 4. SERVER-SIDE CHECK 3: If processing, check provider status via verify-payment server endpoint
    if (order.status === "processing") {
      console.log(`[verify-and-refund] Order ${order_id} is processing. Running server-side provider verification first...`);
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
