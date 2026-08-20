import "../deno.d.ts";
declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import {
  sendMnotifyVoiceCall,
  sendMnotifyQuickSms,
  registerMnotifySenderId,
  checkMnotifySenderIdStatus,
  fetchMnotifyTemplates,
  createMnotifyTemplate,
  deleteMnotifyTemplate,
  fetchMnotifyIvrScenarios,
  getMnotifyBalance,
  getMnotifyApiKey
} from "../_shared/mnotify.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

async function resolveTargetPhones(supabaseAdmin: any, recipients?: string[], targetGroup?: string): Promise<string[]> {
  if (Array.isArray(recipients) && recipients.length > 0) {
    return Array.from(new Set(
      recipients
        .map((p) => String(p).trim().replace(/[^\d+]/g, ""))
        .filter((p) => p.length >= 9 && !p.startsWith("00000000"))
    ));
  }

  if (!targetGroup) return [];

  const phones = new Set<string>();

  // 1. Fetch from profiles if targetGroup is all_customers, all_users, agents, or sub_agents
  if (targetGroup !== "order_buyers") {
    let from = 0;
    const step = 1000;

    while (true) {
      let query = supabaseAdmin
        .from("profiles")
        .select("phone, whatsapp_number, momo_number, vendor_phone")
        .range(from, from + step - 1);

      if (targetGroup === "agents") {
        query = query.eq("is_agent", true);
      } else if (targetGroup === "sub_agents") {
        query = query.eq("sub_agent_approved", true);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) break;

      for (const row of data) {
        const raw = row.phone || row.whatsapp_number || row.momo_number || row.vendor_phone;
        if (raw && typeof raw === "string") {
          const clean = raw.trim().replace(/[^\d+]/g, "");
          if (clean.length >= 9 && !clean.startsWith("00000000")) {
            phones.add(clean);
          }
        }
      }

      if (data.length < step) break;
      from += step;
    }
  }

  // 2. Fetch from orders if targetGroup is all_customers or order_buyers
  if (targetGroup === "all_customers" || targetGroup === "order_buyers") {
    let from = 0;
    const step = 1000;

    while (true) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select("customer_phone, metadata")
        .range(from, from + step - 1);

      if (error || !data || data.length === 0) break;

      for (const o of data) {
        const rawCustomer = o.customer_phone;
        const rawPayment = o.metadata?.payment_phone || o.metadata?.phone;
        for (const r of [rawCustomer, rawPayment]) {
          if (r && typeof r === "string") {
            const clean = r.trim().replace(/[^\d+]/g, "");
            if (clean.length >= 9 && !clean.startsWith("00000000")) {
              phones.add(clean);
            }
          }
        }
      }

      if (data.length < step) break;
      from += step;
    }
  }

  return Array.from(phones);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Authenticate admin or service role
  const authHeader = req.headers.get("Authorization");
  const userToken = req.headers.get("x-user-access-token");
  const token = (userToken || authHeader?.replace(/^Bearer\s+/i, "") || "").trim();

  if (!token) {
    return json({ error: "Unauthorized: Missing Authorization header" }, 401);
  }

  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
  let user: any = null;

  if (!isServiceRole) {
    const authResult = await verifyAdmin(req, supabaseAdmin);
    if (!authResult.success) {
      return json({ error: authResult.error || "Forbidden: Admin privileges required." }, authResult.status || 403);
    }
    user = authResult.user;
  } else {
    user = { id: "00000000-0000-0000-0000-000000000000", email: "service-role@supabase.local" };
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "get_audience_counts") {
      const [allCustPhones, buyerPhones, userPhones, agentPhones, subAgentPhones] = await Promise.all([
        resolveTargetPhones(supabaseAdmin, undefined, "all_customers"),
        resolveTargetPhones(supabaseAdmin, undefined, "order_buyers"),
        resolveTargetPhones(supabaseAdmin, undefined, "all_users"),
        resolveTargetPhones(supabaseAdmin, undefined, "agents"),
        resolveTargetPhones(supabaseAdmin, undefined, "sub_agents"),
      ]);

      return json({
        success: true,
        counts: {
          all_customers: allCustPhones.length,
          order_buyers: buyerPhones.length,
          all_users: userPhones.length,
          agents: agentPhones.length,
          sub_agents: subAgentPhones.length,
        }
      });
    }

    if (action === "get_templates") {
      const customKey = body.api_key;
      const res = await fetchMnotifyTemplates(supabaseAdmin, customKey);
      return json(res);
    }

    if (action === "create_template") {
      const { title, content, api_key } = body;
      if (!title || !content) {
        return json({ success: false, error: "Template title and content are required." }, 400);
      }
      const res = await createMnotifyTemplate(supabaseAdmin, { title, content }, api_key);
      return json(res);
    }

    if (action === "delete_template") {
      const { template_id, api_key } = body;
      if (!template_id) {
        return json({ success: false, error: "Template ID is required." }, 400);
      }
      const res = await deleteMnotifyTemplate(supabaseAdmin, template_id, api_key);
      return json(res);
    }

    if (action === "get_ivr_scenarios") {
      const customKey = body.api_key;
      const res = await fetchMnotifyIvrScenarios(supabaseAdmin, customKey);
      return json(res);
    }

    if (action === "check_balance") {
      const customKey = body.api_key;
      const res = await getMnotifyBalance(supabaseAdmin, customKey);
      return json(res);
    }

    if (action === "send_voice_call" || action === "send_voice") {
      const { campaign, recipients, target_group, voice_id, audio_base64, audio_url, audio_filename, audio_mimetype, is_schedule, schedule_date, api_key } = body;

      const uniquePhones = await resolveTargetPhones(supabaseAdmin, recipients, target_group);

      if (uniquePhones.length === 0) {
        return json({ success: false, error: "No recipient phone numbers found for this campaign. Please ensure your audience or custom phone list has valid contacts." });
      }

      const result = await sendMnotifyVoiceCall(supabaseAdmin, {
        campaign: campaign || "SwiftData Voice Campaign",
        recipients: uniquePhones,
        voiceId: voice_id,
        audioBase64: audio_base64,
        audioUrl: audio_url,
        audioFileName: audio_filename,
        audioMimeType: audio_mimetype,
        isSchedule: is_schedule,
        scheduleDate: schedule_date,
      }, api_key);

      // Log voice campaign in DB
      try {
        await supabaseAdmin.from("audit_logs").insert({
          action: "MNOTIFY_VOICE_CAMPAIGN",
          actor_id: user.id,
          details: {
            campaign,
            recipients_count: uniquePhones.length,
            success: result.success,
            summary: result.summary,
            error: result.error,
          }
        });
      } catch (_e) {
        // Non-critical audit log
      }

      return json(result);
    }

    if (action === "send_sms" || action === "send_quick_sms") {
      const { recipients, target_group, sender, message, is_schedule, schedule_date, sms_type, api_key } = body;

      const uniquePhones = await resolveTargetPhones(supabaseAdmin, recipients, target_group);

      if (uniquePhones.length === 0) {
        return json({ success: false, error: "No recipient phone numbers found for this SMS campaign. Please ensure your audience or custom phone list has valid contacts." });
      }

      const result = await sendMnotifyQuickSms(supabaseAdmin, {
        recipients: uniquePhones,
        sender: sender || "SwiftData",
        message: message,
        isSchedule: is_schedule,
        scheduleDate: schedule_date,
        smsType: sms_type
      }, api_key);

      return json(result);
    }

    if (action === "register_sender_id") {
      const { sender_name, purpose, api_key } = body;
      if (!sender_name) return json({ success: false, error: "Sender Name is required." });
      const result = await registerMnotifySenderId(supabaseAdmin, sender_name, purpose, api_key);
      return json(result);
    }

    if (action === "check_sender_id") {
      const { sender_name, api_key } = body;
      if (!sender_name) return json({ success: false, error: "Sender Name is required." });
      const result = await checkMnotifySenderIdStatus(supabaseAdmin, sender_name, api_key);
      return json(result);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[mnotify-voice] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
