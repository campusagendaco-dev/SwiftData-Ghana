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
  
  const { data: korbaProvider } = await supabaseAdmin
    .from("providers")
    .select("*")
    .eq("name", "Korba")
    .maybeSingle();

  if (korbaProvider) {
    const isAirtime = orderType.toLowerCase() === "airtime";
    const isUtility = orderType.toLowerCase() === "utility";
    const isKorbaFlag = (network && String(network).toUpperCase().startsWith("KORBA")) || 
                        order?.metadata?.is_korba === true || 
                        order?.metadata?.is_korba === "true";
    
    let isMappedToKorba = false;
    if (orderType.toLowerCase() === "data") {
      const queryNetwork = network.startsWith("Korba ") ? network : `Korba ${network}`;
      const { data: korbaMappings } = await supabaseAdmin
        .from("provider_packages")
        .select("id, network")
        .eq("provider_id", korbaProvider.id)
        .eq("package_name", order.package_size);
      
      const hasMapping = (korbaMappings || []).some(
        m => m.network === network || m.network === queryNetwork
      );
      if (hasMapping) {
        isMappedToKorba = true;
      }
    }

    if (isAirtime || isUtility || isKorbaFlag || isMappedToKorba) {
      console.log(`[resolveProvidersForOrder] Resolved Korba provider for order ${order.id} (Airtime=${isAirtime}, Utility=${isUtility}, Flag=${isKorbaFlag}, Mapped=${isMappedToKorba})`);
      return [korbaProvider];
    }
  }
  
  if (orderType.toLowerCase() === "afa") {
    const { data: spendless } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("handler_type", "spendless")
      .maybeSingle();
    if (spendless) {
      console.log(`[resolveProvidersForOrder] Resolved Spendless provider for AFA order ${order.id}`);
      return [spendless];
    } else {
      console.warn(`[resolveProvidersForOrder] Spendless provider not found in DB for AFA. Falling back to active data providers.`);
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

  return activeProviders;
}
