// Approve or reject a queued AI agent task. Admin only, with 2FA (verifyAdmin defaults).
// Body: { task_id: string, approve: boolean }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { decideTask } from "../_shared/agent_task_decide.ts";
import { agentSms } from "../_shared/agent_sms.ts";

declare const Deno: any;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

  const auth = await verifyAdmin(req, db);
  if (!auth.success) return json({ error: auth.error || "Unauthorized" }, auth.status || 401);
  const adminId = auth.user?.id;
  if (!adminId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const taskId = typeof body?.task_id === "string" ? body.task_id.trim() : "";
  if (!taskId) return json({ error: "task_id is required" }, 400);
  if (typeof body?.approve !== "boolean") return json({ error: "approve must be true or false" }, 400);

  try {
    const res = await decideTask(db, { taskId, approve: body.approve, adminId }, { sms: agentSms });
    return json(res.body, res.status);
  } catch (err: any) {
    console.error("[ai-task-decide] failed:", err);
    return json({ error: err?.message || "Failed to decide task" }, 500);
  }
});
