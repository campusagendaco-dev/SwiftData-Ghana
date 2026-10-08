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
  paymentMethod?: string | null;
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
  orderType?: string | null,
  paymentMethod?: string | null
) {
  // 0. Handle non-telecom order types (Wallet Top-up, Direct Debit, Agent Activation)
  const typeLower = String(orderType || "").toLowerCase();
  const pkgUpper = String(metadata?.package_size || metadata?.package_name || "").toUpperCase();

  const isWalletTopup = typeLower === "wallet_topup" || typeLower === "store_wallet_topup" || typeLower === "topup" || typeLower === "deposit" || pkgUpper.includes("WALLET TOPUP") || pkgUpper.includes("WALLET TOP-UP");
  const isAgentActivation = typeLower === "agent_activation" || typeLower === "sub_agent_activation" || pkgUpper.includes("ACTIVATION");

  if (isWalletTopup) {
    const pmLower = String(paymentMethod || metadata?.payment_method || metadata?.gateway || metadata?.payment_type || "").toLowerCase();
    const isDirect = pmLower === "direct_debit";
    const isWalletTransfer = pmLower === "wallet";
    
    // Explicit Admin deposit detection
    const isExplicitAdmin = 
      pmLower === "admin" || 
      pmLower === "manual" || 
      pmLower === "system" ||
      metadata?.source === "admin" || 
      metadata?.method === "admin_manual_credit" || 
      metadata?.type === "admin_deposit";

    const hasPaystackRef = Boolean(
      metadata?.paystack_reference || 
      (typeof metadata?.reference === "string" && (metadata.reference.startsWith("DEP-") || metadata.reference.startsWith("T"))) ||
      (providerOrderId && String(providerOrderId).toLowerCase().includes("paystack")) ||
      pmLower === "paystack"
    );

    const ref = providerOrderId || metadata?.paystack_reference || metadata?.reference || metadata?.transaction_id || null;

    if (isExplicitAdmin || (!hasPaystackRef && !isDirect && !isWalletTransfer)) {
      return {
        name: "Admin Deposit",
        badgeClass: "bg-sky-500/15 text-sky-400 border-sky-500/30",
        refId: ref || metadata?.admin_id || null,
        isPendingDispatch: false,
      };
    }

    let name = isDirect ? "Direct Debit" : (isWalletTransfer ? "Wallet Transfer" : (hasPaystackRef ? "Paystack Gateway" : "Wallet Top-up"));
    if (providerName && (providerName.toLowerCase().includes("paystack") || providerName.toLowerCase().includes("direct") || providerName.toLowerCase().includes("admin"))) {
      name = providerName;
    }
    return {
      name,
      badgeClass: isDirect ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      refId: ref,
      isPendingDispatch: false,
    };
  }

  if (isAgentActivation) {
    const ref = providerOrderId || metadata?.paystack_reference || metadata?.reference || null;
    return {
      name: "System Billing",
      badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
      refId: ref,
      isPendingDispatch: false,
    };
  }

  let matchedName = providerName;
  const allProviders = (providersList && providersList.length > 0) ? providersList : (globalProvidersCache || []);
  const activeProvidersOnly = allProviders.filter(p => p.is_active !== false);

  const rawRefStr = String(providerOrderId || metadata?.provider_order_id || "").trim();

  // If reference explicitly begins with an unmistakable vendor prefix (e.g. SKP), resolve to that provider
  if (rawRefStr.startsWith("SKP")) {
    const skProvider = allProviders.find(p => p.handler_type === "skdataplug" || p.name?.toLowerCase().includes("skplug"));
    if (skProvider) {
      matchedName = skProvider.name;
    }
  }

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

  // 4. If no provider_id or provider_order_id or metadata is assigned, the order has NOT passed through any provider yet
  if (!matchedName) {
    const isFailedOrCancelled = status === "fulfillment_failed" || status === "failed" || status === "cancelled" || status === "declined";
    if (isFailedOrCancelled) {
      return {
        name: "Unassigned",
        badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/20",
        refId: null,
        isPendingDispatch: false,
      };
    }
    return {
      name: "Pending Dispatch",
      badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      refId: null,
      isPendingDispatch: true,
    };
  }

  const nameUpper = String(matchedName).toUpperCase();
  let badgeClass = "bg-purple-500/15 text-purple-400 border-purple-500/30";

  if (nameUpper.includes("INACTIVE")) badgeClass = "bg-slate-500/15 text-slate-400 border-slate-500/30";
  else if (nameUpper.includes("DATAMART")) badgeClass = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  else if (nameUpper.includes("SPENDLESS")) badgeClass = "bg-sky-500/15 text-sky-400 border-sky-500/30";
  else if (nameUpper.includes("KORBA")) badgeClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
  else if (nameUpper.includes("TXTCONNECT")) badgeClass = "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  else if (nameUpper.includes("HUBTEL")) badgeClass = "bg-rose-500/15 text-rose-400 border-rose-500/30";
  else if (nameUpper.includes("BUNDLEZONE")) badgeClass = "bg-teal-500/15 text-teal-400 border-teal-500/30";
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
  paymentMethod,
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
    orderType,
    paymentMethod
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
        <span className="text-[9px] text-amber-400/90 font-mono truncate max-w-[130px]" title="Order is in system queue awaiting carrier API dispatch">
          Ref: Auto Router Queue
        </span>
      )}
    </div>
  );
}

export default ProviderBadge;
