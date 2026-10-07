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
    .eq("handler_type", "korba")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const rawNetUpper = String(order?.network || "").toUpperCase();
  const isDataOrder = orderType === "data" || !orderType || orderType === "sme";

  const orderCategory = String(order?.metadata?.category || order?.metadata?.package_category || "").toLowerCase();
  const isExplicitKorbaCategory = orderCategory !== "" && 
    orderCategory !== "affordable" && 
    orderCategory !== "sme" && 
    orderCategory !== "mashup" && 
    !orderCategory.includes("sme");

  const pkgUpper = String(order?.package_size || "").toUpperCase();
  const isKorbaPackagePattern = pkgUpper.startsWith("GHS") || 
    pkgUpper.includes("RACT_DATA") || 
    pkgUpper.includes("KOKROKOO") || 
    pkgUpper.includes("MIDNIGHT") || 
    pkgUpper.includes("SOCIAL") || 
    pkgUpper.includes("VIDEO") || 
    pkgUpper.includes("IDD");

  let isExplicitKorba = korbaProvider && (
    uppercaseNet.startsWith("KORBA") || 
    order?.metadata?.is_korba === true || 
    order?.metadata?.is_korba === "true" ||
    orderCategory === "korba" ||
    orderCategory === "standard" ||
    isExplicitKorbaCategory ||
    isKorbaPackagePattern ||
    order?.metadata?.provider_type === "korba" ||
    order?.payment_method === "korba"
  );

  if (!isExplicitKorba && korbaProvider && order?.package_size) {
    const cleanPkg = String(order.package_size).replace(/\s+/g, "").toUpperCase();
    const { data: korbaPkgs } = await supabaseAdmin
      .from("provider_packages")
      .select("external_id, package_name, raw_data")
      .eq("provider_id", korbaProvider.id)
      .eq("is_active", true);

    if (korbaPkgs && korbaPkgs.length > 0) {
      const matched = korbaPkgs.some((p: any) => 
        String(p.package_name || "").replace(/\s+/g, "").toUpperCase() === cleanPkg ||
        String(p.external_id || "").replace(/\s+/g, "").toUpperCase() === cleanPkg ||
        String(p.raw_data?.name || "").replace(/\s+/g, "").toUpperCase().includes(cleanPkg) ||
        String(p.raw_data?.product_id || "").replace(/\s+/g, "").toUpperCase() === cleanPkg
      );
      if (matched) {
        console.log(`[resolveProvidersForOrder] Order ${order?.id} package ${order?.package_size} matched Korba provider_packages row.`);
        isExplicitKorba = true;
      }
    }
  }

  if (isExplicitKorba) {
    console.log(`[resolveProvidersForOrder] Resolved Korba provider for Korba order ${order?.id}`);
    return [korbaProvider];
  }

  // Affirm rule: Affordable SME bundles (MTN, Telecel, AirtelTigo) are NEVER routed to Korba
  const isAffordableSmeBundle = isDataOrder && !isExplicitKorba && (
    rawNetUpper.includes("MTN") || 
    rawNetUpper.includes("YELLO") || 
    rawNetUpper.includes("TELECEL") || 
    rawNetUpper.includes("VODA") || 
    rawNetUpper.includes("AIRTEL") || 
    rawNetUpper.includes("TIGO") || 
    rawNetUpper.includes("AT") ||
    rawNetUpper.includes("SME")
  );

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

  // 4. Exclude Spendless from airtime orders (Spendless provides Data and AFA)
  if (orderType === "airtime") {
    activeProviders = activeProviders.filter((p: any) => p.handler_type !== "spendless");
  }

  // Route ECG and Utilities directly to Korba API
  if (orderType === "utility") {
    if (korbaProvider && korbaProvider.is_active) {
      console.log(`[resolveProvidersForOrder] Routing utility/ECG order ${order?.id} directly to Korba API`);
      return [korbaProvider, ...activeProviders.filter((p: any) => p.id !== korbaProvider.id)];
    }
  }

  // Route Airtime orders to Korba API as primary/preferred provider
  if (orderType === "airtime") {
    if (korbaProvider && korbaProvider.is_active) {
      console.log(`[resolveProvidersForOrder] Routing airtime order ${order?.id} to Korba API`);
      activeProviders = [korbaProvider, ...activeProviders.filter((p: any) => p.handler_type !== "korba" && p.name !== "Korba")];
    }
  } else {
    // 5. Exclude Korba from primary list for standard data orders, but keep it available as fallback below
    activeProviders = activeProviders.filter((p: any) => p.handler_type !== "korba" && p.name !== "Korba");
  }

  // Round-robin load balancing for providers sharing top priority (e.g. DataHub & BundleZone both at Priority 1)
  if (activeProviders.length > 1) {
    const topPriority = activeProviders[0]?.priority ?? 1;
    const topTier = activeProviders.filter((p: any) => p.priority === topPriority && (p.consecutive_failures || 0) < 3);
    if (topTier.length > 1) {
      const orderSeed = String(order?.id || order?.reference || order?.created_at || Math.random());
      const hash = orderSeed.split("").reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
      const shift = hash % topTier.length;
      if (shift > 0) {
        const rotatedTop = [...topTier.slice(shift), ...topTier.slice(0, shift)];
        const rest = activeProviders.filter((p: any) => !topTier.some((t: any) => t.id === p.id));
        activeProviders = [...rotatedTop, ...rest];
        console.log(`[resolveProvidersForOrder] Round-robin balanced Priority ${topPriority} providers: 1st=${activeProviders[0]?.name}, 2nd=${activeProviders[1]?.name}`);
      }
    }
  }

  // 6. Append Korba at the end of activeProviders as a fallback provider for Airtime ONLY:
  // - Airtime: All networks supported
  // - Affordable SME bundles: NEVER routed to Korba
  if (korbaProvider && korbaProvider.is_active && !isAfaOrder && !isAffordableSmeBundle && orderType === "airtime") {
    if (!activeProviders.some((p: any) => p.id === korbaProvider.id)) {
      activeProviders.push(korbaProvider);
    }
  }

  // 7. Check if order was ALREADY ACCEPTED by a provider.
  // Rule 1: Once an order is accepted by a provider with a valid provider-side ID,
  // lock to assigned provider ONLY. Non-acceptance IDs (failed_api_call, timeout, manual_fulfillment_mode)
  // or failed statuses MUST NOT lock the order so it can cascade/retry to SKPlug or other providers.
  const validProviderOrderId = Boolean(
    order?.provider_order_id &&
    order.provider_order_id !== "failed_api_call" &&
    order.provider_order_id !== "timeout" &&
    order.provider_order_id !== "manual_fulfillment_mode"
  );
  const isFulfilledOrActive = ["fulfilled", "delivered", "completed"].includes(String(order?.status || "").toLowerCase()) ||
    (order?.status === "processing" && validProviderOrderId);

  const isAcceptedByProvider = Boolean(order?.provider_id) && validProviderOrderId && isFulfilledOrActive;

  if (isAcceptedByProvider) {
    const assigned = activeProviders.find((p: any) => p.id === order.provider_id);
    if (assigned) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} ALREADY ACCEPTED by provider ${assigned.name} (${assigned.id}). Locking to assigned provider ONLY.`);
      return [assigned];
    }
    const { data: explicitProvider } = await supabaseAdmin
      .from("providers")
      .select("*")
      .eq("id", order.provider_id)
      .maybeSingle();
    if (explicitProvider && explicitProvider.is_active) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} ALREADY ACCEPTED by provider ${explicitProvider.name}. Locking to assigned provider ONLY.`);
      return [explicitProvider];
    }
  }

  // If order was previously attempted on a provider and failed (e.g. Spendless failed_api_call or status failed),
  // move that failed provider to the END of activeProviders so healthy providers (e.g. SKPlug, DataHub) are tried first!
  const hasFailedOnAssigned = Boolean(order?.provider_id) && (
    order?.provider_order_id === "failed_api_call" ||
    order?.status === "fulfillment_failed" ||
    order?.status === "failed" ||
    Boolean(order?.failure_reason)
  );

  if (hasFailedOnAssigned && order?.provider_id) {
    const failedIndex = activeProviders.findIndex((p: any) => p.id === order.provider_id);
    if (failedIndex !== -1) {
      const [failedProv] = activeProviders.splice(failedIndex, 1);
      activeProviders.push(failedProv);
      console.log(`[resolveProvidersForOrder] Order ${order?.id} previously failed on ${failedProv.name}. Demoted ${failedProv.name} to end of list.`);
    }
  } else if (order?.provider_id && !hasFailedOnAssigned) {
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
        if (explicitProvider.handler_type === "korba" && isAffordableSmeBundle) {
          console.log(`[resolveProvidersForOrder] Blocked assigned Korba provider for SME bundle ${order?.id}`);
        } else {
          activeProviders.unshift(explicitProvider);
          console.log(`[resolveProvidersForOrder] Prioritizing assigned provider ${explicitProvider.name} for order ${order?.id}`);
        }
      }
    }
  }

  // 8. Handle non-beneficiary / forced fallback (e.g. Spendless or SKPlug for non-beneficiary bypass)
  const isForceFallback = order?.metadata?.route_via_datamart === true || order?.metadata?.bypass_beneficiary === true;
  if (isForceFallback) {
    const designated = activeProviders.find((p: any) => p.settings?.is_beneficiary_fallback === true);
    if (designated) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} using admin-selected fallback provider ${designated.name}...`);
      return [designated, ...activeProviders.filter((p: any) => p.id !== designated.id)];
    }
    // If DataHub requires beneficiary whitelist, prioritize Spendless or SKPlug for bypass
    const nonBeneficiaryProv = activeProviders.find((p: any) => p.handler_type === "spendless" || p.handler_type === "skdataplug");
    if (nonBeneficiaryProv) {
      console.log(`[resolveProvidersForOrder] Order ${order?.id} marked for non-beneficiary bypass. Prioritizing ${nonBeneficiaryProv.name}...`);
      return [nonBeneficiaryProv, ...activeProviders.filter((p: any) => p.id !== nonBeneficiaryProv.id)];
    }
  }

  return activeProviders;
}
