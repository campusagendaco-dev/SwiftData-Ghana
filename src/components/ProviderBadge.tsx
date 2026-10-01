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
    const { data } = await supabase.from("providers").select("id, name, handler_type, provider_type, is_active");
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
  const activeProviders = (providersList && providersList.length > 0) ? providersList : (globalProvidersCache || []);

  // 1. Try matching providerId in providers list
  if (!matchedName && providerId && activeProviders.length > 0) {
    const found = activeProviders.find((p) => p.id === providerId);
    if (found) matchedName = found.name;
  }

  // 2. Try metadata fields
  if (!matchedName && metadata?.provider_name) {
    matchedName = metadata.provider_name;
  }
  if (!matchedName && metadata?.handler_type) {
    const foundByHandler = activeProviders.find(p => p.handler_type === metadata.handler_type);
    matchedName = foundByHandler?.name || metadata.handler_type;
  }
  if (!matchedName && (metadata?.route_via_datamart === true || metadata?.bypass_beneficiary === true)) {
    matchedName = "Datamart (Fallback)";
  }
  if (!matchedName && (metadata?.is_korba === true || metadata?.is_korba === "true")) {
    matchedName = "Korba";
  }

  // 3. Fallback UUID snippet
  if (!matchedName && providerId) {
    matchedName = `Provider (${providerId.slice(0, 6)})`;
  }

  // 4. Inferred final provider from network and order category when provider_id wasn't populated on legacy rows
  if (!matchedName) {
    const netUpper = String(network || "").toUpperCase();
    const typeLower = String(orderType || "").toLowerCase();

    if (netUpper.includes("AFA") || typeLower === "afa") {
      matchedName = "Spendless (AFA)";
    } else if (typeLower === "airtime") {
      matchedName = netUpper.includes("MTN") ? "TxtConnect Airtime" : "Korba Airtime";
    } else if (netUpper.includes("MTN") || netUpper.includes("YELLO")) {
      matchedName = "Datamart (Primary)";
    } else if (netUpper.includes("TELECEL") || netUpper.includes("VODA") || netUpper.includes("AIRTEL") || netUpper.includes("AT")) {
      matchedName = "Spendless / Korba";
    }
  }

  if (!matchedName) {
    if (status === "fulfilled" || status === "processing") {
      matchedName = "Primary Gateway";
    } else {
      return {
        name: "Not Dispatched",
        badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
        refId: null,
      };
    }
  }

  const nameUpper = String(matchedName).toUpperCase();
  let badgeClass = "bg-purple-500/15 text-purple-400 border-purple-500/30";

  if (nameUpper.includes("DATAMART")) badgeClass = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  else if (nameUpper.includes("SPENDLESS")) badgeClass = "bg-sky-500/15 text-sky-400 border-sky-500/30";
  else if (nameUpper.includes("KORBA")) badgeClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
  else if (nameUpper.includes("TXTCONNECT")) badgeClass = "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  else if (nameUpper.includes("HUBTEL")) badgeClass = "bg-rose-500/15 text-rose-400 border-rose-500/30";
  else if (nameUpper.includes("NTA")) badgeClass = "bg-teal-500/15 text-teal-400 border-teal-500/30";
  else if (nameUpper.includes("SUPERB")) badgeClass = "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";

  return {
    name: matchedName,
    badgeClass,
    refId: providerOrderId || metadata?.provider_order_id || null,
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
    </div>
  );
}

export default ProviderBadge;
