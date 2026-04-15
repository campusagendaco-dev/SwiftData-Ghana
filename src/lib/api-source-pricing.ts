import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_API_SOURCE = "primary" as const;
export const API2_MARKUP_MULTIPLIER = 1.0811;

export type ApiSource = "primary" | "secondary";

export const getMultiplierFromSource = (source: ApiSource): number =>
  source === "secondary" ? API2_MARKUP_MULTIPLIER : 1;

export const applyPriceMultiplier = (price: number, multiplier: number): number =>
  Number((price * multiplier).toFixed(2));

export async function fetchApiPricingContext(): Promise<{ source: ApiSource; multiplier: number }> {
  const { data, error } = await supabase.functions.invoke("system-settings", { body: { action: "get" } });

  let source: ApiSource = data?.active_api_source === "secondary" ? "secondary" : "primary";
  let customMarkupPct = Number(data?.secondary_price_markup_pct);

  // If the edge function is temporarily unreachable, try direct table read.
  if (error || data?.error) {
    const { data: row } = await supabase
      .from("system_settings")
      .select("preferred_provider, secondary_price_markup_pct")
      .eq("id", 1)
      .maybeSingle();

    if (row) {
      source = row.preferred_provider === "secondary" ? "secondary" : "primary";
      customMarkupPct = Number(row.secondary_price_markup_pct);
    }
  }

  const multiplier = source === "secondary"
    ? Number.isFinite(customMarkupPct)
      ? Number((1 + customMarkupPct / 100).toFixed(6))
      : API2_MARKUP_MULTIPLIER
    : 1;

  return { source, multiplier };
}
