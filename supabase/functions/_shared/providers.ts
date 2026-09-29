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
  // 0. If order already has an assigned provider_id, prioritize that provider!
  if (order?.provider_id) {
    const { data: explicitProvider } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("id", order.provider_id)
      .maybeSingle();
    if (explicitProvider) {
      console.log(`[resolveProvidersForOrder] Prioritizing assigned provider ${explicitProvider.name} (${explicitProvider.id}) for order ${order.id}`);
      return [explicitProvider];
    }
  }

  let orderType = (order?.order_type || "data") as string;
  if (orderType.toLowerCase() === "api") {
    if (String(order?.package_size).toUpperCase() === "AIRTIME") {
      orderType = "airtime";
    } else {
      orderType = "data";
    }
  }
  const network = (order?.network || "") as string;
  
  const isDataOrder = orderType.toLowerCase() === "data";
  const isAffordable = isDataOrder && (
    order?.metadata?.category === "affordable" || 
    order?.metadata?.category === "Affordable SME" ||
    String(order?.package_size || "").toLowerCase().includes("sme")
  );

  const { data: korbaProvider } = await supabaseAdmin
    .from("providers")
    .select("*")
    .eq("name", "Korba")
    .maybeSingle();

  if (korbaProvider) {
    const isKorbaFlag = (network && String(network).toUpperCase().startsWith("KORBA")) || 
                        order?.metadata?.is_korba === true || 
                        order?.metadata?.is_korba === "true" ||
                        order?.payment_method === "korba";
    
    if (isKorbaFlag) {
      console.log(`[resolveProvidersForOrder] Resolved Korba provider for explicit Korba order ${order.id} (is_korba=true)`);
      return [korbaProvider];
    }
  }
  
  const isAfaOrder = orderType.toLowerCase() === "afa" || 
                     (network && (network.toUpperCase() === "AFA" || network.toUpperCase().startsWith("AFA")));
  
  if (isAfaOrder) {
    const { data: spendless } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "spendless")
      .maybeSingle();
    if (spendless) {
      console.log(`[resolveProvidersForOrder] Resolved Spendless provider for AFA order ${order.id}`);
      return [spendless];
    } else {
      console.warn(`[resolveProvidersForOrder] Spendless provider not found in DB for AFA.`);
      return [];
    }
  }
  
  const providerCategory = orderType === "airtime" ? "airtime" : (orderType === "utility" ? "utility" : "data");
  let activeProviders = await getActiveProviders(supabaseAdmin, providerCategory);

  if (orderType === "airtime" && activeProviders.length === 0) {
    console.log(`[resolveProvidersForOrder] No explicit airtime providers found. Searching provider_packages for mapped Airtime packages for network: ${network}`);
    // Find provider mappings for this network's Airtime package
    const { data: mappings } = await supabaseAdmin
      .from("provider_packages")
      .select("provider_id")
      .eq("network", network)
      .ilike("package_name", "%Airtime%")
      .eq("is_active", true);

    if (mappings && mappings.length > 0) {
      const providerIds = mappings.map((m: any) => m.provider_id);
      const { data: mappedProviders } = await supabaseAdmin
        .from("providers")
        .select("*")
        .in("id", providerIds)
        .eq("is_active", true)
        .order("priority", { ascending: true });

      if (mappedProviders && mappedProviders.length > 0) {
        console.log(`[resolveProvidersForOrder] Mapped ${mappedProviders.length} providers for airtime via package mappings:`, mappedProviders.map(p => p.name));
        activeProviders = mappedProviders;
      }
    }
  }

  // EXCLUDE Korba from activeProviders for non-Korba orders!
  activeProviders = activeProviders.filter((p: any) => p.handler_type !== "korba" && p.name !== "Korba");

  // Prioritize designated fallback provider (or Datamart) for non-beneficiary or bypass_beneficiary orders
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
