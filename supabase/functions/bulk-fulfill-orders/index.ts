import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // SECURITY: Require admin or service-role authentication
  const authResult = await verifyAdmin(req, supabaseAdmin);
  if (!authResult.success) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch all actionable orders (created in last 30 days to avoid processing very old ones)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error: fetchError } = await supabaseAdmin
    .from("orders")
    .select("id, status, order_type")
    .in("status", ["pending", "paid", "processing", "fulfillment_failed"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true });

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: corsHeaders });
  }

  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No pending orders found", fulfilled: 0, failed: 0, skipped: 0 }), { headers: corsHeaders });
  }

  let fulfilled = 0;
  let failed = 0;
  let skipped = 0;
  const errors: { id: string; reason: string }[] = [];

  for (const order of orders) {
    try {
      // Verify payment with Paystack ONLY if not already marked as paid/processing or is an API order
      const isInternal = order.order_type === "api" || order.status === "paid" || order.status === "processing";
      
      if (!isInternal) {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${order.id}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        });
        const verifyData = await verifyRes.json();

        if (!verifyData.status || !verifyData.data || verifyData.data.status !== "success") {
          // Payment not confirmed — skip (don't mark as failed, might be genuinely unpaid)
          skipped++;
          continue;
        }
      }

      // Payment is confirmed — delegate to verify-payment function for full fulfillment logic
      const fulfillRes = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ reference: order.id }),
      });
      const fulfillData = await fulfillRes.json();

      if (fulfillData.status === "fulfilled") {
        fulfilled++;
      } else if (fulfillData.status === "failed" || fulfillData.status === "not_paid") {
        failed++;
        errors.push({ id: order.id, reason: fulfillData.reason || fulfillData.error || fulfillData.status });
      } else {
        skipped++;
      }

      // Small delay between orders to avoid hammering the provider
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      failed++;
      errors.push({ id: order.id, reason: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      total: orders.length,
      fulfilled,
      failed,
      skipped,
      errors: errors.slice(0, 20), // cap error list
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
