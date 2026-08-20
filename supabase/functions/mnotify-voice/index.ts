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
  fetchMnotifyIvrScenarios,
  getMnotifyBalance,
  getMnotifyApiKey
} from "../_shared/mnotify.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

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

    if (action === "get_templates") {
      const customKey = body.api_key;
      const res = await fetchMnotifyTemplates(supabaseAdmin, customKey);
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
      const { campaign, recipients, voice_id, audio_base64, audio_filename, audio_mimetype, is_schedule, schedule_date, api_key } = body;

      let targetPhones: string[] = [];

      if (Array.isArray(recipients) && recipients.length > 0) {
        targetPhones = recipients;
      } else if (body.target_group) {
        // Resolve target group from DB
        if (body.target_group === "all_users") {
          const { data: users } = await supabaseAdmin
            .from("profiles")
            .select("phone")
            .not("phone", "is", null);
          targetPhones = (users || []).map((u: any) => u.phone).filter(Boolean);
        } else if (body.target_group === "agents") {
          const { data: agents } = await supabaseAdmin
            .from("profiles")
            .select("phone")
            .eq("is_agent", true)
            .not("phone", "is", null);
          targetPhones = (agents || []).map((u: any) => u.phone).filter(Boolean);
        } else if (body.target_group === "sub_agents") {
          const { data: subAgents } = await supabaseAdmin
            .from("profiles")
            .select("phone")
            .eq("sub_agent_approved", true)
            .not("phone", "is", null);
          targetPhones = (subAgents || []).map((u: any) => u.phone).filter(Boolean);
        }
      }

      // Deduplicate and filter valid phone numbers
      const uniquePhones = Array.from(new Set(targetPhones.map(p => String(p).trim()).filter(Boolean)));

      if (uniquePhones.length === 0) {
        return json({ success: false, error: "No recipient phone numbers found for this campaign." });
      }

      const result = await sendMnotifyVoiceCall(supabaseAdmin, {
        campaign: campaign || "SwiftData Voice Campaign",
        recipients: uniquePhones,
        voiceId: voice_id,
        audioBase64: audio_base64,
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
      const { recipients, sender, message, is_schedule, schedule_date, sms_type, api_key } = body;
      let targetPhones: string[] = [];

      if (Array.isArray(recipients) && recipients.length > 0) {
        targetPhones = recipients;
      } else if (body.target_group) {
        if (body.target_group === "all_users") {
          const { data: users } = await supabaseAdmin.from("profiles").select("phone").not("phone", "is", null);
          targetPhones = (users || []).map((u: any) => u.phone).filter(Boolean);
        } else if (body.target_group === "agents") {
          const { data: agents } = await supabaseAdmin.from("profiles").select("phone").eq("is_agent", true).not("phone", "is", null);
          targetPhones = (agents || []).map((u: any) => u.phone).filter(Boolean);
        } else if (body.target_group === "sub_agents") {
          const { data: subAgents } = await supabaseAdmin.from("profiles").select("phone").eq("sub_agent_approved", true).not("phone", "is", null);
          targetPhones = (subAgents || []).map((u: any) => u.phone).filter(Boolean);
        }
      }

      const uniquePhones = Array.from(new Set(targetPhones.map(p => String(p).trim()).filter(Boolean)));
      if (uniquePhones.length === 0) {
        return json({ success: false, error: "No recipient phone numbers found for this SMS campaign." });
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
