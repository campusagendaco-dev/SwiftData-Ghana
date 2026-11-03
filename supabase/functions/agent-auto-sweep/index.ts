import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// DISABLED (security): this sweep credited `user_sales_stats.total_own_profit`
// into agent wallets, but `user_sales_stats` is a VIEW of lifetime profit, so
// the "reset to 0" update silently failed and every call re-credited the full
// lifetime profit again. It also ran with no auth when no Authorization header
// was sent. Profits are already credited per order by credit_order_profits /
// request_withdrawal, so nothing depends on this function.
// Do not re-enable without a ledger of swept amounts and an admin/cron check.

serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({ success: false, error: "agent-auto-sweep is disabled." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
