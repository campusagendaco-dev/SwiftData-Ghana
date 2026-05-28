import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendPaymentSms } from "../_shared/sms.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseGigValue(packageSize: string): string {
  const clean = String(packageSize || "").replace(/\s+/g, "").toUpperCase();
  // Match "1GB", "1.5GB", "100MB", "2GB" etc.
  const match = clean.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = match[2];
    if (unit === "MB") {
      return String(num / 1000); // e.g. "500MB" -> "0.5"
    }
    return String(num); // e.g. "1GB" -> "1"
  }
  // Fallback to extracting just the first number in the package size
  const numOnly = clean.match(/(\d+(?:\.\d+)?)/);
  return numOnly ? numOnly[1] : "1";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Authenticate Request
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) return json({ error: "Unauthorized" }, 401);

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // Validate Admin Role
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return json({ error: "Forbidden: Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { action, format = "text", limit = 100, order_ids } = body;

    if (!action) return json({ error: "Missing action parameter (extract or bulk_fulfill)" }, 400);

    // ── VALIDATE API IS OFF (disable_ordering = true) ─────────────────────────
    const { data: settings } = await supabaseAdmin
      .from("system_settings")
      .select("disable_ordering")
      .eq("id", 1)
      .maybeSingle();

    const isApiOff = settings?.disable_ordering === true;

    if (!isApiOff) {
      return json({ 
        error: "Fulfillment API is currently active. Manual extraction and bulk processing can only happen when the API/Ordering is turned OFF in System Settings to prevent race conditions." 
      }, 400);
    }

    // ── ACTION 1: EXTRACT ORDERS FOR EXCEL OR TEXT ───────────────────────────
    if (action === "extract") {
      const { data: orders, error: fetchError } = await supabaseAdmin
        .from("orders")
        .select("id, customer_phone, network, package_size, amount, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (fetchError) return json({ error: fetchError.message }, 500);

      if (!orders || orders.length === 0) {
        return json({ message: "No pending orders found to extract" }, 200);
      }

      // Mark the extracted pending orders as 'processing' instantly
      const orderIdsToUpdate = orders.map(o => o.id);
      const { error: updateStatusError } = await supabaseAdmin
        .from("orders")
        .update({ status: "processing", failure_reason: "Manual processing in progress" })
        .in("id", orderIdsToUpdate);

      if (updateStatusError) {
        return json({ error: `Failed to transition orders to processing: ${updateStatusError.message}` }, 500);
      }

      if (format === "csv") {
        // Excel/CSV Format
        const csvHeader = "OrderID,Phone,Network,Package,AmountGHS,CreatedAt\n";
        const csvRows = orders.map(o => {
          return `"${o.id}","${o.customer_phone}","${o.network}","${o.package_size}",${o.amount},"${o.created_at}"`;
        }).join("\n");

        return new Response(csvHeader + csvRows, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="orders_extract_pending.csv"`,
          },
        });
      } else {
        // Text Format: e.g., "0540000000 1"
        const textLines = orders.map(o => {
          const phone = o.customer_phone || "";
          const gig = parseGigValue(o.package_size);
          return `${phone} ${gig}`;
        }).join("\n");

        return new Response(textLines, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain",
          },
        });
      }
    }

    // ── ACTION 2: BULK FULFILL SELECTED ORDERS ──────────────────────────────
    if (action === "bulk_fulfill") {
      if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
        return json({ error: "Missing or invalid order_ids array" }, 400);
      }

      console.log(`[Admin Bulk] Starting bulk fulfillment of ${order_ids.length} orders...`);
      let fulfilledCount = 0;
      const failures = [];

      for (const orderId of order_ids) {
        try {
          const { data: order, error: orderError } = await supabaseAdmin
            .from("orders")
            .select("*")
            .eq("id", orderId)
            .maybeSingle();

          if (orderError || !order) {
            failures.push({ orderId, reason: "Order not found" });
            continue;
          }

          if (order.status === "fulfilled") {
            fulfilledCount++;
            continue;
          }

          // Update Status
          const { error: updateError } = await supabaseAdmin
            .from("orders")
            .update({ status: "fulfilled", failure_reason: null })
            .eq("id", orderId);

          if (updateError) {
            failures.push({ orderId, reason: updateError.message });
            continue;
          }

          // Credit Profits
          if (order.agent_id && (order.profit > 0 || order.parent_profit > 0)) {
            try {
              await supabaseAdmin.rpc("credit_order_profits", { p_order_id: orderId });
            } catch (err: any) {
              console.error(`[Admin Bulk] Failed to credit profits for ${orderId}:`, err.message);
            }
          }

          // Send SMS Confirmation
          if (order.customer_phone) {
            await sendPaymentSms(supabaseAdmin, order.customer_phone, "payment_success", {}, order.agent_id);
          }

          fulfilledCount++;
        } catch (err: any) {
          failures.push({ orderId, reason: err.message || "Internal error" });
        }
      }

      return json({
        success: true,
        message: `Successfully fulfilled ${fulfilledCount}/${order_ids.length} orders.`,
        failures: failures.length > 0 ? failures : null,
      });
    }

    return json({ error: "Unsupported action" }, 400);

  } catch (err: any) {
    console.error("[Admin Bulk] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
