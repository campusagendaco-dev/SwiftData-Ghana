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
 * 
 * Rules Enforced:
 * 1. Once an order is ACCEPTED by a provider (res.ok === true), it locks to that provider and NEVER enters a different provider.
 * 2. An order is ONLY marked as fulfillment_failed after it has been attempted and REJECTED by ALL active providers.
 */
export async function dispatchOrderWithFailover(
  supabaseAdmin: any,
  order: any
): Promise<DispatchResult> {
  // Fallback to metadata payment_phone if customer_phone is missing/null
  if (!order.customer_phone && (order.metadata?.payment_phone || order.metadata?.customer_phone || order.metadata?.phone || order.metadata?.recipient_phone)) {
    order.customer_phone = order.metadata.payment_phone || order.metadata.customer_phone || order.metadata.phone || order.metadata.recipient_phone;
    if (order.id) {
      Promise.resolve(supabaseAdmin.from("orders").update({ customer_phone: order.customer_phone }).eq("id", order.id)).catch(() => {});
    }
  }

  const activeProviders = await resolveProvidersForOrder(supabaseAdmin, order);

  if (!activeProviders || activeProviders.length === 0) {
    console.warn(`[HybridRouter] No active providers found for order ${order.id}`);
    return {
      ok: false,
      status: "fulfillment_failed",
      reason: "No active telecom provider configured for this network/package.",
    };
  }

  // Fetch past provider rejections for this order from provider_errors
  const rejectedProviderIds = new Set<string>();
  if (order?.id) {
    const { data: pastErrors } = await supabaseAdmin
      .from("provider_errors")
      .select("provider_id")
      .eq("order_id", order.id);
    if (pastErrors && pastErrors.length > 0) {
      pastErrors.forEach((errRow: any) => {
        if (errRow.provider_id) rejectedProviderIds.add(String(errRow.provider_id));
      });
    }
  }

  let lastFailureReason = "Provider dispatch failed";

  for (let i = 0; i < activeProviders.length; i++) {
    const provider = activeProviders[i];
    const isLastProvider = i === activeProviders.length - 1;

    // If this provider previously rejected this order AND there are other active providers remaining that haven't rejected it yet, skip this provider
    const hasRemainingUntried = activeProviders.some(p => !rejectedProviderIds.has(String(p.id)));
    if (rejectedProviderIds.has(String(provider.id)) && hasRemainingUntried && activeProviders.length > 1) {
      console.log(`[HybridRouter] Provider ${provider.name} (${provider.id}) previously rejected order ${order.id}. Skipping to untried provider...`);
      continue;
    }

    console.log(`[HybridRouter] Attempting Provider ${i + 1}/${activeProviders.length}: ${provider.name} (${provider.handler_type || "standard"}) for order ${order.id}`);

    try {
      const adapter = getProviderAdapter(provider.handler_type || "standard");
      const res = await adapter.purchase(supabaseAdmin, provider, order);

      if (res.ok) {
        const isDelivered = res.status === "delivered" || res.status === "success" || res.status === "successful" || res.status === "fulfilled" || res.status === "completed" || res.status === "sent";
        const isProcessing = res.status === "processing" || res.status === "pending" || res.status === "queued" || res.status === "ongoing";

        console.log(`[HybridRouter] Provider ${provider.name} ACCEPTED order ${order.id} (status: ${res.status}). Locking to ${provider.name}.`);

        // Swift Relearning: Reset consecutive failures upon successful acceptance
        if (provider.id) {
          Promise.resolve(supabaseAdmin.from("providers").update({ consecutive_failures: 0 }).eq("id", provider.id)).catch(() => {});
        }

        // Lock order to this provider and return immediately (NEVER enter a different provider)
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
      console.warn(`[HybridRouter] Provider ${provider.name} REJECTED order ${order.id}: ${lastFailureReason}`);

      // Record rejection log
      if (provider.id && order?.id) {
        rejectedProviderIds.add(String(provider.id));
        Promise.resolve(supabaseAdmin.from("provider_errors").insert({
          provider_id: provider.id,
          order_id: order.id,
          error_message: lastFailureReason,
        })).catch(() => {});
      }

      // Swift Relearning: Increment failure count for provider-side issues
      const isProviderSideIssue = /balance|limit|maintenance|out of stock|server error|502|timeout|down/i.test(lastFailureReason);
      if (isProviderSideIssue && provider.id) {
        Promise.resolve(supabaseAdmin.from("providers").update({ consecutive_failures: (provider.consecutive_failures || 0) + 1 }).eq("id", provider.id)).catch(() => {});
      }

      if (!isLastProvider) {
        console.log(`[HybridRouter] Smart failover: Cascading to next active provider (${activeProviders[i + 1].name})...`);
      }
    } catch (err: any) {
      console.error(`[HybridRouter] Exception while dispatching to ${provider.name}:`, err);
      lastFailureReason = err.message || "Network exception during provider call";
      if (provider.id && order?.id) {
        rejectedProviderIds.add(String(provider.id));
        Promise.resolve(supabaseAdmin.from("provider_errors").insert({
          provider_id: provider.id,
          order_id: order.id,
          error_message: lastFailureReason,
        })).catch(() => {});
      }
    }
  }

  console.warn(`[HybridRouter] Order ${order.id} was REJECTED by ALL ${activeProviders.length} active provider(s). Transitioning to fulfillment_failed.`);
  return {
    ok: false,
    status: "fulfillment_failed",
    reason: `Rejected by all ${activeProviders.length} active provider(s): ${lastFailureReason}`,
  };
}
