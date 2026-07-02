import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export interface Provider {
  id: string;
  name: string;
  api_key: string;
  base_url: string;
  provider_type: "data" | "airtime" | "utility" | "sms";
  priority: number;
  is_active: boolean;
  handler_type?: string;
}

export async function getActiveProviders(supabaseAdmin: any, type: string): Promise<Provider[]> {
  let query = supabaseAdmin
    .from("providers")
    .select("*")
    .eq("is_active", true);

  if (type === "data" || type === "airtime") {
    // Include Korba dynamically for data/airtime since Korba handles all three types
    query = query.or(`provider_type.eq.${type},handler_type.eq.korba`);
  } else {
    query = query.eq("provider_type", type);
  }

  const { data, error } = await query
    .order("priority", { ascending: true })
    .order("handler_type", { ascending: true }); // Prioritize 'datamart' (d) over 'standard' (s)

  if (error) {
    console.error("Error fetching providers:", error);
    return [];
  }
  return data || [];
}

export async function logProviderError(supabaseAdmin: any, providerId: string, orderId: string, error: string) {
  await supabaseAdmin.from("provider_errors").insert({
    provider_id: providerId,
    order_id: orderId,
    error_message: error
  });
}
