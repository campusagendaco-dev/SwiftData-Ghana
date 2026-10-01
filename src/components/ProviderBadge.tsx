import React from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProviderBadgeProps {
  providerId?: string | null;
  providerName?: string | null;
  providerOrderId?: string | null;
  metadata?: any;
  status?: string;
  providers?: any[];
  className?: string;
  showRef?: boolean;
}

export function getProviderDetails(
  providerId?: string | null,
  providerName?: string | null,
  providerOrderId?: string | null,
  metadata?: any,
  status?: string,
  providersList?: any[]
) {
  let matchedName = providerName;

  if (!matchedName && providerId && Array.isArray(providersList) && providersList.length > 0) {
    const found = providersList.find((p) => p.id === providerId);
    if (found) matchedName = found.name;
  }

  if (!matchedName && metadata?.provider_name) {
    matchedName = metadata.provider_name;
  }
  if (!matchedName && metadata?.handler_type) {
    matchedName = metadata.handler_type;
  }

  if (!matchedName && providerId) {
    matchedName = `Provider (${providerId.slice(0, 6)})`;
  }

  if (!matchedName) {
    if (status === "fulfilled" || status === "processing") {
      return {
        name: "Auto-Router",
        badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        refId: providerOrderId || metadata?.provider_order_id || null,
      };
    }
    return {
      name: "Not Dispatched",
      badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
      refId: null,
    };
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
  metadata,
  status,
  providers = [],
  className = "",
  showRef = true,
}: ProviderBadgeProps) {
  const details = getProviderDetails(providerId, providerName, providerOrderId, metadata, status, providers);

  return (
    <div className={cn("inline-flex flex-col gap-0.5 items-start", className)}>
      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors", details.badgeClass)}>
        <Zap className="w-2.5 h-2.5 mr-1 shrink-0" />
        <span className="truncate max-w-[120px]">{details.name}</span>
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
