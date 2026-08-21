import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { fetchViaDb } from "./db_proxy.ts";
import { getActiveProviders, resolveProvidersForOrder, Provider } from "./providers.ts";
import { getProviderAdapter } from "./providers/registry.ts";

export interface DispatchResult {
  ok: boolean;
  status: "fulfilled" | "processing" | "fulfillment_failed" | "queued";
  provider_id?: string;
  provider_order_id?: string;
  prepaid_token?: string;
  reason?: string;
  raw?: any;
}

export function parseCapacity(packageSize: string | null | undefined): number {
  if (!packageSize) return 0;
  const cleaned = packageSize.replace(/\s+/g, "").toUpperCase();

  if (cleaned.includes("20MB") || cleaned.includes("20 MB")) return 20 / 1024;
  if (cleaned.includes("MIDNIGHT") || cleaned.includes("MIDNGT")) return 2.6;
  if (cleaned.includes("200GB")) return 200;

  let parseTarget = cleaned;
  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch) parseTarget = parenMatch[1];

  const match = parseTarget.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (parseTarget.includes("MB") && !parseTarget.includes("GB")) {
    return num / 1024;
  }
  return num;
}

export function normalizeRecipient(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return phone.trim();
}

/**
 * Executes a hybrid multi-provider dispatch with intelligent auto-failover.
 */
export async function dispatchOrderWithFailover(
  supabaseAdmin: any,
  order: any
): Promise<DispatchResult> {
  const activeProviders = await resolveProvidersForOrder(supabaseAdmin, order);

  if (!activeProviders || activeProviders.length === 0) {
    console.warn(`[HybridRouter] No active providers found for order ${order.id}`);
    return {
      ok: false,
      status: "fulfillment_failed",
      reason: "No active telecom provider configured for this network/package.",
    };
  }

  let lastFailureReason = "Provider dispatch failed";

  for (let i = 0; i < activeProviders.length; i++) {
    const provider = activeProviders[i];
    const isLastProvider = i === activeProviders.length - 1;

    console.log(`[HybridRouter] Attempting Provider ${i + 1}/${activeProviders.length}: ${provider.name} (${provider.handler_type || "standard"}) for order ${order.id}`);

    try {
      const adapter = getProviderAdapter(provider.handler_type || "standard");
      const res = await adapter.purchase(supabaseAdmin, provider, order);

      if (res.ok) {
        const isDelivered = res.status === "delivered" || res.status === "success" || res.status === "successful" || res.status === "fulfilled" || res.status === "completed" || res.status === "sent";
        const isProcessing = res.status === "processing" || res.status === "pending" || res.status === "queued" || res.status === "ongoing";

        console.log(`[HybridRouter] Provider ${provider.name} responded with status: ${res.status}`);

        return {
          ok: true,
          status: isDelivered ? "fulfilled" : "processing",
          provider_id: provider.id,
          provider_order_id: res.id || res.raw?.id || res.raw?.order_id || null,
          prepaid_token: (res.raw as any)?.prepaid_token || null,
          reason: res.reason,
          raw: res.raw,
        };
      }

      lastFailureReason = res.reason || `Failed at provider ${provider.name}`;
      console.warn(`[HybridRouter] Provider ${provider.name} failed for order ${order.id}: ${lastFailureReason}`);

      // Check if error is terminal (e.g. invalid phone number format), or if we should cascade failover
      const isTerminalError = /invalid phone|blacklisted|invalid msisdn/i.test(lastFailureReason);
      if (isTerminalError && isLastProvider) {
        break;
      }

      // If there's another provider, log failover transition
      if (!isLastProvider) {
        console.log(`[HybridRouter] Smart failover: Cascading to next provider (${activeProviders[i + 1].name})...`);
      }
    } catch (err: any) {
      console.error(`[HybridRouter] Exception while dispatching to ${provider.name}:`, err);
      lastFailureReason = err.message || "Network exception during provider call";
    }
  }

  return {
    ok: false,
    status: "fulfillment_failed",
    reason: lastFailureReason,
  };
}
