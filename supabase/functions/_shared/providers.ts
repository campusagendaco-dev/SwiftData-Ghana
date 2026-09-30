import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { parseCapacity } from "./providers/utils.ts";

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
    .order("handler_type", { ascending: true });

  if (error) {
    console.error("Error fetching providers:", error);
    return [];
  }

  // Self-Healing Dynamic Routing: Temporarily prioritize healthy providers ahead of degraded ones
  const sorted = (data || []).sort((a: any, b: any) => {
    const aDegraded = (a.consecutive_failures || 0) >= 3 ? 1 : 0;
    const bDegraded = (b.consecutive_failures || 0) >= 3 ? 1 : 0;
    if (aDegraded !== bDegraded) return aDegraded - bDegraded;
    return (a.priority || 99) - (b.priority || 99);
  });

  return sorted;
}

export async function logProviderError(supabaseAdmin: any, providerId: string, orderId: string, error: string) {
  await supabaseAdmin.from("provider_errors").insert({
    provider_id: providerId,
    order_id: orderId,
    error_message: error
  });
}

export async function resolveProvidersForOrder(supabaseAdmin: any, order: any): Promise<Provider[]> {
  let orderType = (order?.order_type || "data") as string;
  if (orderType.toLowerCase() === "api") {
    if (String(order?.package_size).toUpperCase() === "AIRTIME") {
      orderType = "airtime";
    } else {
      orderType = "data";
    }
  }
  const network = (order?.network || "") as string;
  const uppercaseNet = network.toUpperCase();

  // 1. Check if explicit Korba order flag is set
  const { data: korbaProvider } = await supabaseAdmin
    .from("providers")
    .select("*")
    .eq("name", "Korba")
    .maybeSingle();

  const isExplicitKorba = korbaProvider && (
    uppercaseNet.startsWith("KORBA") || 
    order?.metadata?.is_korba === true || 
    order?.metadata?.is_korba === "true" ||
    order?.payment_method === "korba"
  );
  
  if (isExplicitKorba) {
    console.log(`[resolveProvidersForOrder] Resolved Korba provider for explicit Korba order ${order?.id}`);
    return [korbaProvider];
  }

  // 2. Check if AFA order
  const isAfaOrder = orderType.toLowerCase() === "afa" || uppercaseNet === "AFA" || uppercaseNet.startsWith("AFA");
  if (isAfaOrder) {
    const { data: spendless } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "spendless")
      .eq("is_active", true)
      .maybeSingle();
    if (spendless) {
      console.log(`[resolveProvidersForOrder] Resolved Spendless provider for AFA order ${order?.id}`);
      return [spendless];
    } else {
      console.warn(`[resolveProvidersForOrder] Spendless provider not found in DB for AFA.`);
      return [];
    }
  }

  // 3. Get all active providers for this category (data, airtime, or utility)
  const providerCategory = orderType === "airtime" ? "airtime" : (orderType === "utility" ? "utility" : "data");
  let activeProviders = await getActiveProviders(supabaseAdmin, providerCategory);

  // 4. Exclude AFA-only providers (e.g. Spendless) from standard Data/Airtime orders
  if (!isAfaOrder) {
    activeProviders = activeProviders.filter((p: any) => p.handler_type !== "spendless");
  }

  // 5. Exclude Korba from primary list, but keep it available as fallback below
  activeProviders = activeProviders.filter((p: any) => p.handler_type !== "korba" && p.name !== "Korba");

  // 6. Append Korba at the end of activeProviders as a universal fallback provider for Data & Airtime
  if (korbaProvider && korbaProvider.is_active && !isAfaOrder && (orderType === "data" || orderType === "airtime")) {
    if (!activeProviders.some((p: any) => p.id === korbaProvider.id)) {
      activeProviders.push(korbaProvider);
    }
  }

  // 7. If order has an assigned provider_id, prioritize that assigned provider at index 0,
  // BUT KEEP all other active providers behind it for full failover!
  if (order?.provider_id) {
    const assignedIndex = activeProviders.findIndex((p: any) => p.id === order.provider_id);
    if (assignedIndex > 0) {
      const [assigned] = activeProviders.splice(assignedIndex, 1);
      activeProviders.unshift(assigned);
      console.log(`[resolveProvidersForOrder] Prioritizing assigned provider ${assigned.name} (${assigned.id}) for order ${order?.id}`);
    } else if (assignedIndex === -1) {
      const { data: explicitProvider } = await supabaseAdmin
        .from("providers")
        .select("*")
        .eq("id", order.provider_id)
        .maybeSingle();
      if (explicitProvider && explicitProvider.is_active) {
        activeProviders.unshift(explicitProvider);
        console.log(`[resolveProvidersForOrder] Prioritizing assigned provider ${explicitProvider.name} for order ${order?.id}`);
      }
    }
  }

  // 8. Handle non-beneficiary / forced fallback (e.g. Datamart or designated beneficiary fallback)
  const isForceFallback = order?.metadata?.route_via_datamart === true || order?.metadata?.bypass_beneficiary === true;
  if (isForceFallback) {
    const designated = activeProviders.find((p: any) => p.settings?.is_beneficiary_fallback === true);
    if (designated) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} using admin-selected fallback provider ${designated.name}...`);
      return [designated, ...activeProviders.filter((p: any) => p.id !== designated.id)];
    }
    const datamartProv = activeProviders.find((p: any) => p.handler_type === "datamart");
    if (datamartProv) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} marked for non-beneficiary Datamart API. Prioritizing Datamart...`);
      return [datamartProv, ...activeProviders.filter((p: any) => p.id !== datamartProv.id)];
    }
  }

  return activeProviders;
}
