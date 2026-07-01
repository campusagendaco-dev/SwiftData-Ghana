import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchViaDb } from "../_shared/db_proxy.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    // Fetch the user's profile
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, is_agent, is_sub_agent")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr || !profile) {
      return json({ error: "Profile not found" }, 404);
    }

    const payload = await req.json().catch(() => null);
    if (!payload || !payload.action) {
      return json({ error: "Missing action parameter" }, 400);
    }

    const { action } = payload;

    const KORBA_CLIENT_ID = Deno.env.get("KORBA_CLIENT_ID") || "2419";
    const KORBA_CLIENT_KEY = Deno.env.get("KORBA_CLIENT_KEY") || "";
    const KORBA_SECRET_KEY = Deno.env.get("KORBA_SECRET_KEY") || "";

    if (!KORBA_CLIENT_KEY || !KORBA_SECRET_KEY) {
      return json({ error: "Korba gateway credentials not configured in edge functions." }, 500);
    }

    // Resolve Korba Base URL
    const { data: korbaProvider } = await supabaseAdmin
      .from("providers")
      .select("base_url")
      .eq("handler_type", "korba")
      .maybeSingle();

    const baseUrl = (korbaProvider?.base_url || "https://xchange.korba365.com/api/v1.0").replace(/\/+$/, "");

    // Helper to query Korba Direct Debit APIs via DB proxy
    const callDirectDebitApi = async (endpoint: string, apiPayload: any) => {
      const sortedKeys = Object.keys(apiPayload).sort();
      const messageParts = [];
      for (const key of sortedKeys) {
        if (apiPayload[key] !== undefined) {
          messageParts.push(`${key}=${apiPayload[key]}`);
        }
      }
      const message = messageParts.join("&");
      
      const keyData = new TextEncoder().encode(KORBA_SECRET_KEY);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const messageData = new TextEncoder().encode(message);
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const targetUrl = `${baseUrl}/${endpoint.replace(/^\/+/, "")}`;
      console.log(`[direct-debit-action] Calling: ${targetUrl}`);

      const res = await fetchViaDb(supabaseAdmin, targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `HMAC ${KORBA_CLIENT_KEY}:${signatureHex}`,
        },
        body: JSON.stringify(apiPayload),
        disableFallback: true,
      }, 25);

      const resText = await res.text();
      if (!res.ok || resText.includes("Gateway Timeout") || resText.includes("canceling statement")) {
        throw new Error(`Korba API request failed: ${resText || `HTTP ${res.status}`}`);
      }

      try {
        return JSON.parse(resText);
      } catch {
        throw new Error(`Korba API returned non-JSON: ${resText}`);
      }
    };

    switch (action) {
      case "create_mandate": {
        const {
          customer_number,
          amount,
          frequency_type,
          frequency,
          start_date,
          end_date,
          debit_day,
          description,
          payer_name
        } = payload;

        if (!customer_number || !amount || !frequency_type || !frequency || !start_date || !end_date || !debit_day) {
          return json({ error: "Missing required schedule fields" }, 400);
        }

        const transaction_id = `DD-${crypto.randomUUID()}`;

        // Set callback URLs to our webhook
        const mandate_creation_call_back_url = `${SUPABASE_URL}/functions/v1/direct-debit-webhook?type=mandate_creation`;
        const debit_customer_call_back_url = `${SUPABASE_URL}/functions/v1/direct-debit-webhook?type=debit`;

        const apiPayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          customer_number: String(customer_number).trim(),
          transaction_id,
          amount: Number(amount).toFixed(2),
          frequency_type,
          frequency: String(frequency),
          start_date,
          end_date,
          debit_day: String(debit_day),
          mandate_creation_call_back_url,
          debit_customer_call_back_url,
          description: description || "Direct Debit Subscription",
          payer_name: payer_name || profile.id
        };

        const result = await callDirectDebitApi("new_mtn_recurring_create_mandate/", apiPayload);

        if (result.success) {
          // Insert pending mandate into DB
          const { error: dbErr } = await supabaseAdmin
            .from("direct_debit_mandates")
            .insert({
              user_id: user.id,
              customer_number: String(customer_number).trim(),
              transaction_id,
              amount: Number(amount),
              frequency_type,
              frequency: String(frequency),
              start_date,
              end_date,
              debit_day: String(debit_day),
              description: description || null,
              payer_name: payer_name || null,
              status: "pending_pre_approval"
            });

          if (dbErr) {
            console.error("[direct-debit-action] DB Insert error:", dbErr);
            return json({ error: "Failed to store mandate in database" }, 500);
          }

          return json({ success: true, transaction_id, message: result.results });
        } else {
          return json({ success: false, error: result.error_message || "Mandate creation failed" });
        }
      }

      case "update_mandate": {
        const {
          mandate_db_id,
          amount,
          frequency_type,
          frequency,
          start_date,
          end_date,
          debit_day,
          description,
          payer_name
        } = payload;

        if (!mandate_db_id || !amount || !frequency_type || !frequency || !start_date || !end_date || !debit_day) {
          return json({ error: "Missing required fields for update" }, 400);
        }

        // Fetch mandate and verify ownership
        const { data: mandate, error: fetchErr } = await supabaseAdmin
          .from("direct_debit_mandates")
          .select("*")
          .eq("id", mandate_db_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (fetchErr || !mandate) {
          return json({ error: "Mandate not found or unauthorized" }, 404);
        }

        if (!mandate.mandate_id) {
          return json({ error: "Mandate is not approved or active yet" }, 400);
        }

        const transaction_id = `DD-UP-${crypto.randomUUID()}`;

        const apiPayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          mandate_id: mandate.mandate_id,
          transaction_id,
          amount: Number(amount).toFixed(2),
          frequency_type,
          frequency: String(frequency),
          start_date,
          end_date,
          debit_day: String(debit_day),
          description: description || "Direct Debit Subscription Update",
          payer_name: payer_name || profile.id
        };

        const result = await callDirectDebitApi("new_mtn_recurring_update_mandate/", apiPayload);

        if (result.success) {
          // Update DB row
          const { error: dbErr } = await supabaseAdmin
            .from("direct_debit_mandates")
            .update({
              amount: Number(amount),
              frequency_type,
              frequency: String(frequency),
              start_date,
              end_date,
              debit_day: String(debit_day),
              description: description || null,
              payer_name: payer_name || null,
              updated_at: new Date().toISOString()
            })
            .eq("id", mandate_db_id);

          if (dbErr) {
            console.error("[direct-debit-action] DB Update error:", dbErr);
            return json({ error: "Failed to update mandate in database" }, 500);
          }

          return json({ success: true, message: result.results });
        } else {
          return json({ success: false, error: result.error_message || "Mandate update failed" });
        }
      }

      case "cancel_mandate": {
        const { mandate_db_id } = payload;
        if (!mandate_db_id) return json({ error: "Missing mandate_db_id" }, 400);

        // Fetch mandate and verify ownership
        const { data: mandate, error: fetchErr } = await supabaseAdmin
          .from("direct_debit_mandates")
          .select("*")
          .eq("id", mandate_db_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (fetchErr || !mandate) {
          return json({ error: "Mandate not found or unauthorized" }, 404);
        }

        if (!mandate.mandate_id) {
          return json({ error: "Mandate is not approved or active yet" }, 400);
        }

        const apiPayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          mandate_id: mandate.mandate_id
        };

        const result = await callDirectDebitApi("new_mtn_recurring_cancel_mandate/", apiPayload);

        if (result.success) {
          // Update DB row to cancelled
          await supabaseAdmin
            .from("direct_debit_mandates")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString()
            })
            .eq("id", mandate_db_id);

          return json({ success: true, message: "Mandate cancelled successfully" });
        } else {
          return json({ success: false, error: result.error_message || "Mandate cancellation failed" });
        }
      }

      case "cancel_pre_approval": {
        const { customer_number } = payload;
        if (!customer_number) return json({ error: "Missing customer_number" }, 400);

        // Find the pending pre-approval mandate for the customer
        const { data: mandate, error: fetchErr } = await supabaseAdmin
          .from("direct_debit_mandates")
          .select("*")
          .eq("customer_number", String(customer_number).trim())
          .eq("user_id", user.id)
          .eq("status", "pending_pre_approval")
          .maybeSingle();

        if (fetchErr || !mandate) {
          return json({ error: "Pending pre-approval mandate not found for this customer" }, 404);
        }

        const apiPayload = {
          client_id: parseInt(KORBA_CLIENT_ID) || 2419,
          customer_number: String(customer_number).trim()
        };

        const result = await callDirectDebitApi("new_mtn_recurring_cancel_pre_approval/", apiPayload);

        if (result.success) {
          // Update DB row to cancelled
          await supabaseAdmin
            .from("direct_debit_mandates")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString()
            })
            .eq("id", mandate.id);

          return json({ success: true, message: "Pre-approval cancelled successfully" });
        } else {
          return json({ success: false, error: result.error_message || "Pre-approval cancellation failed" });
        }
      }

      default:
        return json({ error: "Unsupported action" }, 400);
    }
  } catch (error: any) {
    console.error("Direct debit action error:", error);
    return json({ error: error.message }, 200);
  }
});
