import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface RequestBody {
  action: "initiate-deposit" | "check-status";
  amount?: number;
  phone?: string;
  network?: string;
  agent_id?: string;
  transaction_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let paystackKey = "";
  try {
    const { data: settings } = await supabase
      .from("system_settings")
      .select("paystack_secret_key")
      .eq("id", 1)
      .maybeSingle();
    paystackKey = settings?.paystack_secret_key || "";
  } catch (dbErr) {
    console.error("Failed to fetch paystack_secret_key from DB in store deposit:", dbErr);
  }

  if (!paystackKey) {
    paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  }

  if (!paystackKey) {
    return new Response(JSON.stringify({ error: "Paystack API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body: RequestBody = await req.json();
    const { action, amount, phone, network, agent_id, transaction_id } = body;

    const headers = {
      "Authorization": `Bearer ${paystackKey}`,
      "Content-Type": "application/json",
    };

    if (action === "initiate-deposit") {
      if (!amount || !phone || !agent_id) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (amount < 1) {
        return new Response(JSON.stringify({ error: "Minimum deposit is GHS 1.00" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const orderId = crypto.randomUUID();
      const totalCharge = amount * 1.03; // Add 3% fee
      
      const payload = {
        amount: Math.round(totalCharge * 100),
        email: user.email || `${phone}@swiftdata.net`,
        reference: orderId,
        mobile_money: {
            phone: phone,
            provider: network?.toLowerCase() || "mtn"
        }
      };

      const resp = await fetch("https://api.paystack.co/charge", { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await resp.json();

      const isSuccess = result.status && (result.data?.status === "success" || result.data?.status === "send_otp" || result.data?.status === "pay_offline");
      const isFailed = !isSuccess;

      await supabase.from("orders").insert({
        id: orderId,
        agent_id: agent_id,
        order_type: "store_wallet_topup",
        amount: amount,
        customer_phone: phone,
        status: isFailed ? "failed" : "pending",
        failure_reason: isFailed ? (result.message || "Failed") : null,
        metadata: {
          paystack_ref: orderId,
          paystack_raw: result,
          customer_id: user.id
        }
      });

      return new Response(JSON.stringify({ ...result, order_id: orderId, status: isFailed ? "failed" : "pending" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (action === "check-status") {
      if (!transaction_id) {
        return new Response(JSON.stringify({ error: "Missing transaction_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: order } = await supabase.from("orders").select("*").eq("id", transaction_id).single();
      
      if (!order) {
        return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (order.status === "fulfilled" || order.status === "failed") {
         return new Response(JSON.stringify({ status: order.status === "fulfilled" ? "successful" : "failed", order }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resp = await fetch(`https://api.paystack.co/transaction/verify/${transaction_id}`, { method: "GET", headers });
      const result = await resp.json();

      const isSuccess = result.status && result.data?.status === "success";
      const isFailed = !isSuccess && result.data?.status === "failed";

      if (isSuccess) {
        await supabase.rpc("fulfill_store_wallet_topup", {
          p_order_id: order.id,
          p_customer_id: order.metadata.customer_id,
          p_agent_id: order.agent_id,
          p_amount: order.amount
        });
        
        await supabase.from("orders").update({
          status: "fulfilled",
          metadata: { ...order.metadata, paystack_raw: result, fulfilled_at: new Date().toISOString() }
        }).eq("id", order.id);
      } else if (isFailed) {
        await supabase.from("orders").update({
          status: "failed",
          failure_reason: result.data?.gateway_response || result.message || "Transaction failed",
          metadata: { ...order.metadata, paystack_raw: result }
        }).eq("id", order.id);
      }

      return new Response(JSON.stringify({
        status: isSuccess ? "successful" : (isFailed ? "failed" : "pending"),
        reason: result.data?.gateway_response || result.message,
        order_id: order.id
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
