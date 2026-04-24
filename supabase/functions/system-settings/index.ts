import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_SETTINGS = {
  active_api_source: "primary",
  secondary_price_markup_pct: 0,
  auto_api_switch: false,
  preferred_provider: "primary",
  backup_provider: "primary",
  holiday_mode_enabled: false,
  holiday_message: "Holiday mode is active. Orders will resume soon.",
  disable_ordering: false,
  dark_mode_enabled: false,
  customer_service_number: "0547636024",
  support_channel_link: "https://whatsapp.com/channel/0029Vb6Xwed60eBaztkH2B3m",
  sub_agent_base_fee: 80,
};

const coerceText = (value: unknown): string => String(value ?? "").trim();

const isMissingColumnError = (message: string, column: string) => {
  const lower = message.toLowerCase();
  const hasColumn = lower.includes(column.toLowerCase());
  const indicatesMissing =
    lower.includes("could not find") ||
    lower.includes("does not exist") ||
    (lower.includes("column") && lower.includes("schema cache"));
  return hasColumn && indicatesMissing;
};

const isMissingTableError = (message: string) => {
  const lower = message.toLowerCase();
  return (
    (lower.includes("relation") && lower.includes("system_settings") && lower.includes("does not exist")) ||
    (lower.includes("could not find") && lower.includes("system_settings") && lower.includes("schema cache"))
  );
};

const saveSettingsRow = async (supabaseAdmin: ReturnType<typeof createClient>, row: Record<string, unknown>) => {
  let payload = { ...row };
  const droppedColumns = new Set<string>();

  const normalizeColumnName = (raw: string) =>
    String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/["'`]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

  const extractMissingColumn = (message: string): string | null => {
    const normalized = String(message || "").replace(/["'`]/g, "");
    const patterns = [
      /column\s+(.+?)\s+does not exist/i,
      /Could not find the\s+(.+?)\s+column/i,
      /column\s+(.+?)\s+of relation\s+system_settings\s+does not exist/i,
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        return normalizeColumnName(match[1]);
      }
    }

    return null;
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await supabaseAdmin.from("system_settings").upsert(payload);
    if (!error) {
      return { error: null, payload, droppedColumns: Array.from(droppedColumns) };
    }

    const msg = String(error.message || "");

    const missingColumn = extractMissingColumn(msg);
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      const { [missingColumn]: _drop, ...next } = payload;
      payload = next;
      droppedColumns.add(missingColumn);
      continue;
    }

    if (payload.updated_by && isMissingColumnError(msg, "updated_by")) {
      const { updated_by: _drop, ...next } = payload;
      payload = next;
      droppedColumns.add("updated_by");
      continue;
    }

    if (payload.active_api_source && isMissingColumnError(msg, "active_api_source")) {
      const { active_api_source: _drop, ...next } = payload;
      payload = next;
      droppedColumns.add("active_api_source");
      continue;
    }

    if (payload.secondary_price_markup_pct && isMissingColumnError(msg, "secondary_price_markup_pct")) {
      const { secondary_price_markup_pct: _drop, ...next } = payload;
      payload = next;
      droppedColumns.add("secondary_price_markup_pct");
      continue;
    }

    if (payload.sub_agent_base_fee && isMissingColumnError(msg, "sub_agent_base_fee")) {
      const { sub_agent_base_fee: _drop, ...next } = payload;
      payload = next;
      droppedColumns.add("sub_agent_base_fee");
      continue;
    }

    return { error, payload, droppedColumns: Array.from(droppedColumns) };
  }

  return { error: { message: "Unable to save settings with current schema" }, payload, droppedColumns: Array.from(droppedColumns) };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured: missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const readSettings = async () => {
    const fullSelect =
      "auto_api_switch, preferred_provider, backup_provider, holiday_mode_enabled, holiday_message, disable_ordering, dark_mode_enabled, customer_service_number, support_channel_link, active_api_source, secondary_price_markup_pct, sub_agent_base_fee";
    const legacySelect =
      "auto_api_switch, preferred_provider, backup_provider, holiday_mode_enabled, holiday_message, disable_ordering, dark_mode_enabled, customer_service_number, support_channel_link";

    const { data: fullData, error: fullError } = await supabaseAdmin
      .from("system_settings")
      .select(fullSelect)
      .eq("id", 1)
      .maybeSingle();

    const { data, error } = fullError
      ? await supabaseAdmin
          .from("system_settings")
          .select(legacySelect)
          .eq("id", 1)
          .maybeSingle()
      : { data: fullData, error: null as { message?: string } | null };

    if (error) {
      const missingTable = isMissingTableError(String(error.message || ""));
      return {
        ...DEFAULT_SETTINGS,
        table_ready: !missingTable,
        warning: missingTable ? "system_settings table missing" : error.message,
      };
    }

    return {
      auto_api_switch: false,
      preferred_provider: "primary",
      backup_provider: "primary",
      active_api_source: "primary",
      secondary_price_markup_pct: 0,
      holiday_mode_enabled: Boolean(data?.holiday_mode_enabled),
      holiday_message: String(data?.holiday_message || DEFAULT_SETTINGS.holiday_message),
      disable_ordering: Boolean(data?.disable_ordering),
      dark_mode_enabled: Boolean(data?.dark_mode_enabled),
      customer_service_number:
        coerceText(data?.customer_service_number) || DEFAULT_SETTINGS.customer_service_number,
      support_channel_link:
        coerceText(data?.support_channel_link) || DEFAULT_SETTINGS.support_channel_link,
      sub_agent_base_fee: Number(data?.sub_agent_base_fee ?? DEFAULT_SETTINGS.sub_agent_base_fee),
      table_ready: true,
      warning: null,
    };
  };

  try {
    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = payload?.action === "set" ? "set" : "get";

    if (action === "get") {
      const settings = await readSettings();
      return new Response(JSON.stringify({ success: true, ...settings }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1);

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preferredProvider = "primary";
    const backupProvider = "primary";
    const activeApiSource = "primary";
    const secondaryMarkupPct = 0;

    const { data: existingSettings } = await supabaseAdmin
      .from("system_settings")
      .select("customer_service_number, support_channel_link")
      .eq("id", 1)
      .maybeSingle();

    const existingCustomerServiceNumber =
      coerceText(existingSettings?.customer_service_number) || DEFAULT_SETTINGS.customer_service_number;
    const existingSupportChannelLink =
      coerceText(existingSettings?.support_channel_link) || DEFAULT_SETTINGS.support_channel_link;

    const requestedCustomerServiceNumber = coerceText(payload?.customer_service_number);
    const requestedSupportChannelLink = coerceText(payload?.support_channel_link);

    const subAgentBaseFeeRaw = Number(payload?.sub_agent_base_fee);
    const subAgentBaseFee = Number.isFinite(subAgentBaseFeeRaw)
      ? Math.max(0, Number(subAgentBaseFeeRaw.toFixed(2)))
      : DEFAULT_SETTINGS.sub_agent_base_fee;
    const holidayMessage =
      String(payload?.holiday_message || DEFAULT_SETTINGS.holiday_message).trim() || DEFAULT_SETTINGS.holiday_message;
    const customerServiceNumber = requestedCustomerServiceNumber || existingCustomerServiceNumber;
    const supportChannelLink = requestedSupportChannelLink || existingSupportChannelLink;

    const row = {
      id: 1,
      auto_api_switch: false,
      preferred_provider: activeApiSource || preferredProvider,
      backup_provider: backupProvider,
      active_api_source: activeApiSource,
      secondary_price_markup_pct: secondaryMarkupPct,
      holiday_mode_enabled: Boolean(payload?.holiday_mode_enabled),
      holiday_message: holidayMessage,
      disable_ordering: Boolean(payload?.disable_ordering),
      dark_mode_enabled: Boolean(payload?.dark_mode_enabled),
      customer_service_number: customerServiceNumber,
      support_channel_link: supportChannelLink,
      sub_agent_base_fee: subAgentBaseFee,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };

    const { error: saveError, payload: persistedRow, droppedColumns } = await saveSettingsRow(supabaseAdmin, row);

    if (saveError) {
      return new Response(JSON.stringify({ error: saveError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      ...persistedRow,
      active_api_source: String((persistedRow.active_api_source as string) || (persistedRow.preferred_provider as string) || activeApiSource),
      secondary_price_markup_pct: Number(persistedRow.secondary_price_markup_pct ?? secondaryMarkupPct),
      sub_agent_base_fee: Number(persistedRow.sub_agent_base_fee ?? subAgentBaseFee),
      table_ready: true,
      warning: droppedColumns.length > 0 ? `Saved with legacy schema. Dropped columns: ${droppedColumns.join(", ")}` : null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
