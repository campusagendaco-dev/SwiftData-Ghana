import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendSmsViaTxtConnect, getSmsConfig, normalizePhone } from "../_shared/sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { agent_id, action } = await req.json(); // action: 'lock' | 'unlock'

    if (!agent_id || !['lock', 'unlock'].includes(action)) {
      throw new Error("Invalid parameters");
    }

    const isLocked = action === 'lock';

    // 1. Update Profile
    const { data: profile, error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ terminal_locked: isLocked })
      .eq("user_id", agent_id)
      .select("full_name, phone")
      .single();

    if (updateError) throw updateError;

    // 2. Fetch SMS Config & Templates
    const { apiKey, senderId, templates: anyTemplates } = await getSmsConfig(supabaseAdmin);
    const { data: settings } = await supabaseAdmin.from("v_system_settings_with_secrets").select("terminal_locked_sms_message, terminal_unlocked_sms_message").single();
    
    const message = isLocked 
      ? (settings?.terminal_locked_sms_message || "Your terminal has been LOCKED.")
      : (settings?.terminal_unlocked_sms_message || "Your terminal has been UNLOCKED.");

    // 3. Send SMS
    const recipient = normalizePhone(profile.phone);
    if (recipient && apiKey) {
      console.log(`Sending ${action} SMS to ${recipient}...`);
      await sendSmsViaTxtConnect(apiKey, senderId, recipient, message);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Terminal ${isLocked ? 'locked' : 'unlocked'} and SMS sent to ${profile.full_name}` 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
