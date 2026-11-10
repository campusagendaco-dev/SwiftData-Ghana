import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyAdmin } from "../_shared/auth.ts";
import { dispatchUnifiedSms, formatTemplate, getSmsConfig, normalizePhone } from "../_shared/sms.ts";
import { lookupIpCity } from "../_shared/ip_location.ts";
import { GHANA_TOWNS } from "../_shared/ghana_towns.ts";
import { matchTownByName } from "../_shared/location_rules.ts";
import { applyConsent, runLocationCheck, type ClaimResult, type LocationDeps } from "../_shared/location_flow.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const today = () => new Date().toISOString().slice(0, 10);

function buildDeps(db: any): LocationDeps {
  return {
    today,
    now: () => new Date().toISOString(),
    normalizePhone,
    async getSettings() {
      const { data } = await db
        .from("system_settings")
        .select("location_sms_mode, location_sms_daily_limit")
        .eq("id", 1)
        .maybeSingle();
      return {
        mode: data?.location_sms_mode === "consent" ? "consent" : "off",
        dailyLimit: Number.isInteger(data?.location_sms_daily_limit) ? data.location_sms_daily_limit : 0,
      };
    },
    async isAdmin(userId) {
      const { data, error } = await db
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .limit(1);
      if (error) throw new Error(error.message);
      return !!(data && data.length > 0);
    },
    async getProfile(userId) {
      const { data } = await db
        .from("profiles")
        .select("phone, sms_opt_out")
        .eq("user_id", userId)
        .maybeSingle();
      return data ? { phone: data.phone ?? null, sms_opt_out: !!data.sms_opt_out } : null;
    },
    async getPrefs(userId) {
      const { data, error } = await db
        .from("location_alert_preferences")
        .select("status, prompted_at, last_check_on")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async savePrefs(userId, patch) {
      const { error } = await db
        .from("location_alert_preferences")
        .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    lookupIp: (ip) => lookupIpCity(ip, Deno.env.get("IPGEOLOCATION_API_KEY")),
    async getTownRows(userId) {
      const { data, error } = await db
        .from("user_location_towns")
        .select("town_key, town_name, first_seen_on, last_seen_on, days_seen, is_home, established_at, sms_sent_at")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async saveTownRow(userId, row) {
      // Step 1: create the row if missing, never touching an existing one (no sms_sent_at here).
      const { error: insErr } = await db.from("user_location_towns").upsert(
        {
          user_id: userId,
          town_key: row.town_key,
          town_name: row.town_name,
          first_seen_on: row.first_seen_on,
          last_seen_on: row.last_seen_on,
          days_seen: row.days_seen,
        },
        { onConflict: "user_id,town_key", ignoreDuplicates: true },
      );
      if (insErr) throw new Error(insErr.message);
      // Step 2: update only fields that are safe under concurrency.
      const patch: Record<string, unknown> = {
        town_name: row.town_name,
        last_seen_on: row.last_seen_on,
        days_seen: row.days_seen,
      };
      if (row.is_home) patch.is_home = true;
      if (row.established_at) patch.established_at = row.established_at;
      const { error: updErr } = await db
        .from("user_location_towns")
        .update(patch)
        .eq("user_id", userId)
        .eq("town_key", row.town_key);
      if (updErr) throw new Error(updErr.message);
    },
    async deleteTownRows(userId) {
      const { error } = await db.from("user_location_towns").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    async claimSms(userId, townKey, dailyLimit) {
      const { data, error } = await db.rpc("claim_location_sms", {
        p_user_id: userId,
        p_town_key: townKey,
        p_daily_limit: dailyLimit,
      });
      if (error) throw new Error(error.message);
      return data as ClaimResult;
    },
    async releaseClaim(userId, townKey) {
      const { error } = await db
        .from("user_location_towns")
        .update({ sms_sent_at: null, established_at: null })
        .eq("user_id", userId)
        .eq("town_key", townKey);
      if (error) throw new Error(error.message);
    },
    sendSms: (phone, townName) => sendWelcome(db, phone, townName),
  };
}

async function sendWelcome(db: any, phone: string, townName: string): Promise<"sent" | "no_template" | "failed"> {
  try {
    const cfg = await getSmsConfig(db);
    const body = cfg.templates?.location_welcome;
    if (!body) return "no_template";
    if (!cfg.apiKey || !cfg.senderId) return "failed";
    if (!normalizePhone(phone)) return "failed";
    // Only a thrown error means failed: a null result can follow a delivered 2xx non-JSON reply.
    await dispatchUnifiedSms(
      cfg.gateway,
      cfg.apiKey,
      cfg.senderId,
      phone,
      formatTemplate(body, { town: townName }),
      "location_welcome",
    );
    return "sent";
  } catch (err) {
    console.error("[location-check] sms send failed:", (err as Error)?.message);
    return "failed";
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let reqAction: unknown;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      null;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const deps = buildDeps(supabaseAdmin);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const action = body?.action;
    reqAction = action;

    switch (action) {
      case "check": {
        const result = await runLocationCheck(deps, { userId: user.id, ip, lat: body.lat, lng: body.lng });
        return json({ needs_consent: result.needs_consent });
      }
      case "status": {
        const [settings, admin, prefs, profile] = await Promise.all([
          deps.getSettings(),
          deps.isAdmin(user.id),
          deps.getPrefs(user.id),
          deps.getProfile(user.id),
        ]);
        const phone = normalizePhone(profile?.phone);
        return json({
          eligible: !admin && settings.mode !== "off" && !!phone,
          is_admin: admin,
          has_phone: !!phone,
          status: prefs?.status ?? "unset",
          sms_opt_out: !!profile?.sms_opt_out,
        });
      }
      case "set_consent": {
        const choice = body.choice;
        if (choice !== "yes" && choice !== "no" && choice !== "dismissed") {
          return json({ error: "Invalid choice" }, 400);
        }
        const version = body.version;
        if (choice !== "dismissed" && (typeof version !== "string" || version.length < 1 || version.length > 20)) {
          return json({ error: "Invalid version" }, 400);
        }
        await applyConsent(deps, user.id, choice, typeof version === "string" ? version : "");
        return json({ ok: true });
      }
      case "set_sms_opt_out": {
        if (typeof body.value !== "boolean") return json({ error: "Invalid value" }, 400);
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ sms_opt_out: body.value })
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "admin_stats": {
        const admin = await verifyAdmin(req, supabaseAdmin, { checkMfa: true });
        if (!admin.success) return json({ error: admin.error }, admin.status || 403);
        const midnight = `${today()}T00:00:00.000Z`;
        const count = async (q: any) => {
          const { count: c, error } = await q;
          if (error) throw new Error(error.message);
          return c ?? 0;
        };
        const prefs = () => supabaseAdmin.from("location_alert_preferences").select("*", { count: "exact", head: true });
        const towns = () => supabaseAdmin.from("user_location_towns").select("*", { count: "exact", head: true });
        const [granted, declined, sentToday, sentTotal, settings] = await Promise.all([
          count(prefs().eq("status", "granted")),
          count(prefs().eq("status", "declined")),
          count(towns().gte("sms_sent_at", midnight)),
          count(towns().not("sms_sent_at", "is", null)),
          deps.getSettings(),
        ]);
        return json({
          granted,
          declined,
          sent_today: sentToday,
          sent_total: sentTotal,
          mode: settings.mode,
          daily_limit: settings.dailyLimit,
        });
      }
      case "admin_set_settings": {
        const admin = await verifyAdmin(req, supabaseAdmin, { checkMfa: true });
        if (!admin.success) return json({ error: admin.error }, admin.status || 403);
        const patch: Record<string, unknown> = {};
        if (body.mode !== undefined) {
          if (body.mode !== "off" && body.mode !== "consent") return json({ error: "Invalid mode" }, 400);
          patch.location_sms_mode = body.mode;
        }
        if (body.daily_limit !== undefined) {
          if (!Number.isInteger(body.daily_limit) || body.daily_limit < 0) {
            return json({ error: "Invalid daily_limit" }, 400);
          }
          patch.location_sms_daily_limit = body.daily_limit;
        }
        if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, 400);
        const { error } = await supabaseAdmin.from("system_settings").update(patch).eq("id", 1);
        if (error) throw new Error(error.message);
        return json({ ok: true });
      }
      case "admin_test_send": {
        const admin = await verifyAdmin(req, supabaseAdmin, { checkMfa: true });
        if (!admin.success) return json({ error: admin.error }, admin.status || 403);
        const town = matchTownByName(String(body.town ?? ""), "GH", GHANA_TOWNS);
        if (!town) return json({ error: "Unknown town" }, 400);
        const profile = await deps.getProfile(user.id);
        const phone = normalizePhone(profile?.phone);
        if (!phone) return json({ ok: false, error: "no_phone" });
        const result = await sendWelcome(supabaseAdmin, phone, town.name);
        return json(result === "sent" ? { ok: true } : { ok: false, error: result });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("[location-check] failed:", (err as Error)?.message);
    if (reqAction === "check") return json({ needs_consent: false });
    return json({ ok: false, error: "failed" }, 500);
  }
});
