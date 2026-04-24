import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizePhone, getSmsConfig, sendSmsViaTxtConnect } from "../_shared/sms.ts";

type TargetType = "all" | "agents" | "users" | "pending_orders";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 200, // Important: Changed to 200 so Supabase JS Client can parse data.error instead of throwing generic exception
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { apiKey: txtApiKey, senderId: txtSenderId } = await getSmsConfig(supabaseAdmin);

  if (!txtApiKey || !txtSenderId) {
    return new Response(JSON.stringify({
      error: "SMS not configured. Please add your TxtConnect API Key in Admin → Settings or set the TXTCONNECT_API_KEY environment variable.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      data: { user: actor },
      error: actorError,
    } = await supabaseUser.auth.getUser();

    if (actorError || !actor) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", actor.id)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const target_type = (payload?.target_type || "all") as TargetType | "test";
    const title = String(payload?.title || "").trim();
    const message = String(payload?.message || "").trim();
    const test_phone = String(payload?.test_phone || "").trim();

    if (!message) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smsBody = title ? `${title}\n${message}` : message;

    // Test mode: send to a single provided number
    if (target_type === "test") {
      const normalized = normalizePhone(test_phone);
      if (!normalized) {
        return new Response(JSON.stringify({ error: "Invalid test phone number" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sendSmsViaTxtConnect(txtApiKey, txtSenderId, normalized, smsBody);
      return new Response(JSON.stringify({ success: true, sent: 1, target_type: "test", to: normalized }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["all", "agents", "users", "pending_orders"].includes(target_type)) {
      return new Response(JSON.stringify({ error: "Invalid target_type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniquePhones = new Set<string>();
    let skipped = 0;
    let totalRecipients = 0;
    let sent = 0;
    const failures: Array<{ phone: string; reason: string }> = [];
    const CONCURRENCY_LIMIT = 5;
    const FETCH_BATCH_SIZE = 1000;

    if (target_type === "pending_orders") {
      const { data: pendingOrders, error: ordersError } = await supabaseAdmin
        .from("orders")
        .select("customer_phone")
        .eq("status", "pending");

      if (ordersError) throw ordersError;

      const phonesToProcess = (pendingOrders || [])
        .map(r => normalizePhone(r.customer_phone))
        .filter((p): p is string => !!p);
      
      totalRecipients = (pendingOrders || []).length;
      skipped = totalRecipients - phonesToProcess.length;

      // Process in parallel chunks
      for (let i = 0; i < phonesToProcess.length; i += CONCURRENCY_LIMIT) {
        const chunk = phonesToProcess.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(async (phone) => {
          try {
            await sendSmsViaTxtConnect(txtApiKey, txtSenderId, phone, smsBody);
            sent += 1;
          } catch (error) {
            failures.push({ phone, reason: error instanceof Error ? error.message : "Unknown error" });
          }
        }));
      }
    } else {
      // --- Paginated Fetching for Large User Bases ---
      let hasMore = true;
      let offset = 0;

      while (hasMore) {
        let profilesQuery = supabaseAdmin
          .from("profiles")
          .select("phone, is_agent, is_sub_agent, agent_approved, sub_agent_approved")
          .range(offset, offset + FETCH_BATCH_SIZE - 1);

        if (target_type === "agents") {
          profilesQuery = profilesQuery.or('is_agent.eq.true,is_sub_agent.eq.true,agent_approved.eq.true,sub_agent_approved.eq.true');
        } else if (target_type === "users") {
          profilesQuery = profilesQuery
            .eq('is_agent', false)
            .eq('is_sub_agent', false)
            .eq('agent_approved', false)
            .eq('sub_agent_approved', false);
        }

        const { data: recipients, error: recipientsError } = await profilesQuery;
        if (recipientsError) throw recipientsError;

        if (!recipients || recipients.length === 0) {
          hasMore = false;
          break;
        }

        const phonesToProcess = recipients
          .map(r => normalizePhone(r.phone))
          .filter((p): p is string => !!p && !uniquePhones.has(p));
        
        // Add unique phones to our set to prevent duplicates across batches
        phonesToProcess.forEach(p => uniquePhones.add(p));
        
        totalRecipients += recipients.length;
        skipped += (recipients.length - phonesToProcess.length);

        // Process this batch
        for (let i = 0; i < phonesToProcess.length; i += CONCURRENCY_LIMIT) {
          const chunk = phonesToProcess.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.all(chunk.map(async (phone) => {
            try {
              await sendSmsViaTxtConnect(txtApiKey, txtSenderId, phone, smsBody);
              sent += 1;
            } catch (error) {
              failures.push({ phone, reason: error instanceof Error ? error.message : "Unknown error" });
            }
          }));
        }

        if (recipients.length < FETCH_BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += FETCH_BATCH_SIZE;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      target_type,
      total_recipients: totalRecipients,
      valid_numbers: uniquePhones.size,
      sent,
      failed: failures.length,
      skipped_invalid_or_empty: skipped,
      failures: failures.slice(0, 20),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("admin-send-sms error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
