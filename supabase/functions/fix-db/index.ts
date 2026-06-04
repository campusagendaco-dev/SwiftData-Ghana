import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.3.4/mod.js";

serve(async (req) => {
  try {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) throw new Error("Missing DB URL");
    
    const sql = postgres(dbUrl);
    
    const result = await sql`
      SELECT n.nspname as schema_name, p.proname as function_name, pg_get_functiondef(p.oid) as definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.proname IN ('create_order_rpc', 'debit_wallet', 'credit_wallet', 'refund_failed_order')
    `;
    
    await sql.end();
    
    return new Response(JSON.stringify({ success: true, functions: result }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
