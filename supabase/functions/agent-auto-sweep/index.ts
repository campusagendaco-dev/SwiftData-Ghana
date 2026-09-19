import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: any;

const SUPABASE_URL = (Deno as any).env.get("SUPABASE_URL") as string;
const SUPABASE_SERVICE_ROLE_KEY = (Deno as any).env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const cronSecret = (Deno as any).env.get("CRON_SECRET");
    const isCron = cronSecret && req.headers.get("X-Cron-Secret") === cronSecret;

    if (!isCron && authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);
    }

    // 1. Fetch sales stats for agents with pending profit earnings
    const { data: stats, error: statsErr } = await supabaseAdmin
      .from("user_sales_stats")
      .select("user_id, total_own_profit, total_commissions_paid")
      .gt("total_own_profit", 0);

    if (statsErr) throw statsErr;

    let sweptCount = 0;
    let totalSweptAmount = 0;

    for (const item of stats || []) {
      const userId = item.user_id;
      const profitToSweep = Number(item.total_own_profit || 0);

      // Minimum sweep threshold GHS 10
      if (profitToSweep < 10) continue;

      // Fetch user wallet
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("id, balance")
        .eq("agent_id", userId)
        .maybeSingle();

      if (!wallet) continue;

      const newBalance = Number(wallet.balance || 0) + profitToSweep;

      // Credit main wallet
      await supabaseAdmin
        .from("wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", wallet.id);

      // Reset pending profit to 0
      await supabaseAdmin
        .from("user_sales_stats")
        .update({ total_own_profit: 0 })
        .eq("user_id", userId);

      // Record transaction ledger entry
      await supabaseAdmin.from("wallet_transactions").insert({
        user_id: userId,
        amount: profitToSweep,
        transaction_type: "profit_sweep",
        balance_after: newBalance,
        description: `Automated agent profit sweep: GHS ${profitToSweep.toFixed(2)} credited to main wallet`,
      });

      sweptCount++;
      totalSweptAmount += profitToSweep;
    }

    return json({
      success: true,
      swept_agents: sweptCount,
      total_amount_swept: totalSweptAmount,
    });
  } catch (err: any) {
    console.error("agent-auto-sweep error:", err);
    return json({ error: err.message || "Failed to execute profit sweep" }, 500);
  }
});
