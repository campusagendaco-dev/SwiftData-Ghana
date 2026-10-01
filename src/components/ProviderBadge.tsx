import React, { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface ProviderBadgeProps {
  providerId?: string | null;
  providerName?: string | null;
  providerOrderId?: string | null;
  network?: string | null;
  orderType?: string | null;
  metadata?: any;
  status?: string;
  providers?: any[];
  className?: string;
  showRef?: boolean;
}

// Global in-memory cache for providers list across the app
let globalProvidersCache: any[] | null = null;
let isFetchingProviders = false;
const listeners: Set<() => void> = new Set();

async function ensureProvidersLoaded() {
  if (globalProvidersCache !== null || isFetchingProviders) return;
  isFetchingProviders = true;
  try {
    const { data } = await supabase.from("providers").select("id, name, handler_type, provider_type, is_active, priority").order("priority", { ascending: true });
    if (data) {
      globalProvidersCache = data;
      listeners.forEach((l) => l());
    }
  } catch {
    /* ignore */
  } finally {
    isFetchingProviders = false;
  }
}

export function getProviderDetails(
  providerId?: string | null,
  providerName?: string | null,
  providerOrderId?: string | null,
  metadata?: any,
  status?: string,
  providersList?: any[],
  network?: string | null,
  orderType?: string | null
) {
  let matchedName = providerName;
  const allProviders = (providersList && providersList.length > 0) ? providersList : (globalProvidersCache || []);
  const activeProvidersOnly = allProviders.filter(p => p.is_active !== false);

  // 1. Try matching providerId in all providers list (including explicit provider_id assignment)
  if (!matchedName && providerId && allProviders.length > 0) {
    const found = allProviders.find((p) => p.id === providerId);
    if (found) {
      if (found.is_active !== false) {
        matchedName = found.name;
      } else if (providerOrderId || metadata?.provider_order_id) {
        // Was actually processed by an inactive provider before it was deactivated
        matchedName = `${found.name} (Inactive)`;
      } else {
        // Assigned provider is inactive AND order has no provider_order_id: ignore and let active provider resolve
        matchedName = null;
      }
    }
  }

  // 2. Try metadata fields
  if (!matchedName && metadata?.provider_name) {
    const foundMeta = allProviders.find(p => p.name?.toLowerCase() === String(metadata.provider_name).toLowerCase());
    if (!foundMeta || foundMeta.is_active !== false) {
      matchedName = metadata.provider_name;
    }
  }
  if (!matchedName && metadata?.handler_type) {
    const foundByHandler = activeProvidersOnly.find(p => p.handler_type === metadata.handler_type);
    if (foundByHandler) {
      matchedName = foundByHandler.name;
    }
  }

  // 3. Fallback UUID snippet if provider_id was present but not found in active cache
  if (!matchedName && providerId && (providerOrderId || metadata?.provider_order_id)) {
    matchedName = `Provider (${providerId.slice(0, 6)})`;
  }

  // 4. Resolve top ACTIVE provider from DB based on order category and network (skips inactive providers like Datamart)
  if (!matchedName) {
    const typeLower = String(orderType || "data").toLowerCase();

    // Filter active providers for this category
    const activeForCategory = activeProvidersOnly.filter(p => {
      const pType = (p.provider_type || "data").toLowerCase();
      if (typeLower === "airtime") return pType === "airtime" || p.handler_type === "korba";
      if (typeLower === "utility") return pType === "utility";
      return pType === "data" || p.handler_type === "spendless" || p.handler_type === "korba";
    }).sort((a, b) => (a.priority || 99) - (b.priority || 99));

    if (activeForCategory.length > 0) {
      matchedName = activeForCategory[0].name;
    }
  }

  if (!matchedName) {
    if (status === "fulfilled" || status === "processing") {
      matchedName = "Active Gateway";
    } else {
      return {
        name: "Not Dispatched",
        badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
        refId: null,
        isPendingDispatch: true,
      };
    }
  }

  const nameUpper = String(matchedName).toUpperCase();
  let badgeClass = "bg-purple-500/15 text-purple-400 border-purple-500/30";

  if (nameUpper.includes("INACTIVE")) badgeClass = "bg-slate-500/15 text-slate-400 border-slate-500/30";
  else if (nameUpper.includes("DATAMART")) badgeClass = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  else if (nameUpper.includes("SPENDLESS")) badgeClass = "bg-sky-500/15 text-sky-400 border-sky-500/30";
  else if (nameUpper.includes("KORBA")) badgeClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
  else if (nameUpper.includes("TXTCONNECT")) badgeClass = "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  else if (nameUpper.includes("HUBTEL")) badgeClass = "bg-rose-500/15 text-rose-400 border-rose-500/30";
  else if (nameUpper.includes("NTA")) badgeClass = "bg-teal-500/15 text-teal-400 border-teal-500/30";
  else if (nameUpper.includes("SUPERB")) badgeClass = "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";

  const rawRef = providerOrderId || metadata?.provider_order_id || null;

  return {
    name: matchedName,
    badgeClass,
    refId: rawRef,
    isPendingDispatch: !rawRef && (status === "processing" || status === "pending" || status === "waiting"),
  };
}

export function ProviderBadge({
  providerId,
  providerName,
  providerOrderId,
  network,
  orderType,
  metadata,
  status,
  providers = [],
  className = "",
  showRef = true,
}: ProviderBadgeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    ensureProvidersLoaded();
    const update = () => setTick((t) => t + 1);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  const details = getProviderDetails(
    providerId,
    providerName,
    providerOrderId,
    metadata,
    status,
    providers,
    network,
    orderType
  );

  return (
    <div className={cn("inline-flex flex-col gap-0.5 items-start", className)}>
      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors", details.badgeClass)}>
        <Zap className="w-2.5 h-2.5 mr-1 shrink-0" />
        <span className="truncate max-w-[130px]">{details.name}</span>
      </span>
      {showRef && details.refId && (
        <span className="text-[9px] text-muted-foreground/80 font-mono truncate max-w-[130px]" title={String(details.refId)}>
          Ref: #{String(details.refId).slice(0, 12)}
        </span>
      )}
      {showRef && !details.refId && details.isPendingDispatch && (
        <span className="text-[9px] text-amber-400/90 font-mono truncate max-w-[130px]" title="Order is queued / awaiting carrier API handshake">
          Ref: Pending Dispatch
        </span>
      )}
    </div>
  );
}

export default ProviderBadge;
