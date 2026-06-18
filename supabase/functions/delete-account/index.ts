import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Verify the user
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`User ${user.id} requested account deletion`);

    // SECURITY: Block deletion if user has a non-zero wallet balance
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance, api_balance")
      .eq("agent_id", user.id)
      .maybeSingle();

    const mainBalance = Number(wallet?.balance ?? 0);
    const apiBalance = Number(wallet?.api_balance ?? 0);

    if (mainBalance > 0.01) {
      return new Response(JSON.stringify({ 
        error: `Cannot delete account with remaining wallet balance of GHS ${mainBalance.toFixed(2)}. Please withdraw your funds first.`,
        code: "balance_remaining"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (apiBalance > 0.01) {
      return new Response(JSON.stringify({ 
        error: `Cannot delete account with remaining API wallet balance of GHS ${apiBalance.toFixed(2)}. Please withdraw your API funds first.`,
        code: "api_balance_remaining"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Block deletion if user has active/pending orders that may need refunds
    const { data: activeOrders } = await supabaseAdmin
      .from("orders")
      .select("id, status, amount")
      .eq("agent_id", user.id)
      .in("status", ["paid", "processing", "pending"])
      .limit(1);

    if (activeOrders && activeOrders.length > 0) {
      return new Response(JSON.stringify({ 
        error: "Cannot delete account with active orders in progress. Please wait for all orders to complete first.",
        code: "active_orders"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Block deletion if user has pending withdrawal requests
    const { data: pendingWithdrawals } = await supabaseAdmin
      .from("withdrawals")
      .select("id, amount")
      .eq("agent_id", user.id)
      .eq("status", "pending")
      .limit(1);

    if (pendingWithdrawals && pendingWithdrawals.length > 0) {
      return new Response(JSON.stringify({ 
        error: "Cannot delete account with a pending withdrawal request.",
        code: "pending_withdrawal"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Delete the user from Auth (this will trigger CASCADE on profiles)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error(`Error deleting user ${user.id}:`, deleteError.message);
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`User ${user.id} account successfully deleted`);
    return new Response(JSON.stringify({ success: true, message: "Account deleted successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("delete-account error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
