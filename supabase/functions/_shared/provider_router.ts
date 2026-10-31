import { resolveProvidersForOrder, isOrderPausedFromApi, type Provider } from "./providers.ts";
import { getProviderAdapter } from "./providers/registry.ts";
import { isNonRetryableTerminalError, isDuplicateOrderError, isBeneficiaryFailure } from "./providers/utils.ts";
import { autoSubmitBeneficiaryNumber } from "./beneficiary_auto_submit.ts";

export interface DispatchResult {
  ok: boolean;
  status: "fulfilled" | "processing" | "fulfillment_failed" | "queued";
  provider_id?: string;
  provider_order_id?: string;
  prepaid_token?: string;
  reason?: string;
  raw?: any;
  delayed?: boolean;
  delayed_until?: string;
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
  if (isOrderPausedFromApi(order)) {
    console.log(`[HybridRouter] Order ${order?.id} is paused by admin from entering API provider. Skipping dispatch.`);
    return {
      ok: false,
      status: "processing",
      provider_order_id: "paused_by_admin",
      reason: "Paused by admin — held from entering API provider",
    };
  }

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

  // Fetch past provider rejections for this order from provider_errors and metadata
  const rejectedProviderIds = new Set<string>();
  if (Array.isArray(order?.metadata?.failed_provider_ids)) {
    order.metadata.failed_provider_ids.forEach((pid: any) => {
      if (pid) rejectedProviderIds.add(String(pid));
    });
  }
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
    const hasRemainingUntried = activeProviders.some((p: Provider) => !rejectedProviderIds.has(String(p.id)));
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

      // Duplicate Order Cooldown Guard: Carrier or Aggregator deduplication window (e.g. BundleZone)
      // Stop failing duplicate orders immediately. Halt cascade across other providers (to prevent double charges),
      // and keep the order in processing with duplicate_cooldown to automatically re-route after 60 mins.
      if (isDuplicateOrderError(lastFailureReason)) {
        console.warn(`[HybridRouter] Duplicate order detected for order ${order.id} (${lastFailureReason}). Scheduling 60-minute cooldown auto-route.`);
        const delayedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        if (order?.id) {
          await supabaseAdmin.from("orders").update({
            status: "processing",
            provider_order_id: "duplicate_cooldown",
            failure_reason: `Duplicate order detected. Delayed for auto-routing after 60 mins. (${lastFailureReason})`,
            last_retry_at: new Date().toISOString(),
            metadata: {
              ...(order.metadata || {}),
              duplicate_delayed: true,
              delayed_until: delayedUntil,
              last_duplicate_reason: lastFailureReason,
            }
          }).eq("id", order.id);
        }
        return {
          ok: false,
          status: "processing",
          provider_order_id: "duplicate_cooldown",
          reason: `Duplicate order detected. Delayed for auto-routing after 60 mins. (${lastFailureReason})`,
          delayed: true,
          delayed_until: delayedUntil,
        };
      }

      // Beneficiary Whitelist Rejection Guard: Auto-submit recipient number to carrier whitelist
      // and failover immediately to non-beneficiary bypass providers (DataMart, SKDataPlug, Spendless)
      const isBeneficiaryErr = isBeneficiaryFailure(lastFailureReason);
      if (isBeneficiaryErr) {
        console.warn(`[HybridRouter] Order ${order.id} rejected due to beneficiary whitelist at ${provider.name} (${lastFailureReason}). Auto-submitting recipient number to carrier whitelist...`);
        
        if (order.customer_phone) {
          autoSubmitBeneficiaryNumber(supabaseAdmin, order.customer_phone, "provider_rejection_auto_submit", order.id)
            .then((subRes: { success: boolean; error?: string }) => console.log(`[HybridRouter] Beneficiary auto-submission for ${order.customer_phone}:`, subRes.success ? "SUBMITTED" : "FAILED"))
            .catch((subErr: unknown) => console.error(`[HybridRouter] Beneficiary auto-submission error:`, subErr));
        }

        order.metadata = {
          ...(order.metadata || {}),
          bypass_beneficiary: true,
          route_via_datamart: true,
          non_beneficiary_auto_submitted: true,
          last_beneficiary_rejection: lastFailureReason,
        };

        // If other providers remain, re-order remaining providers so non-beneficiary providers (BundleZone MTN_EXPRESS, DataMart, SKPlug, Spendless) are attempted first
        if (!isLastProvider) {
          const remaining = activeProviders.slice(i + 1);
          const nonBenProviders = remaining.filter((p: Provider) => (p.handler_type === "bundlezone" && p.settings?.express_mode_enabled === true) || p.handler_type === "datamart" || p.handler_type === "skdataplug" || p.handler_type === "spendless" || p.settings?.is_beneficiary_fallback === true);
          const otherRemaining = remaining.filter((p: Provider) => !nonBenProviders.includes(p));
          
          if (nonBenProviders.length > 0) {
            console.log(`[HybridRouter] Re-ordering cascade: Prioritizing ${nonBenProviders.map((p: Provider) => p.name).join(", ")} for non-beneficiary delivery bypass.`);
            activeProviders.splice(i + 1, remaining.length, ...nonBenProviders, ...otherRemaining);
          }
        }
      }

      // Financial & Terminal Recipient Safety Guard: If rejection is a permanent client/recipient error, HALT CASCADE immediately
      // This prevents multi-provider duplicate charges, vendor bans, and company financial losses
      if (!isBeneficiaryErr && isNonRetryableTerminalError(lastFailureReason)) {
        console.warn(`[HybridRouter] Halting cascade for order ${order.id}: Terminal recipient error (${lastFailureReason}). Prevented duplicate provider debits.`);
        return {
          ok: false,
          status: "processing",
          provider_order_id: "failed_api_call",
          reason: lastFailureReason,
        };
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

  const finalIsBeneficiary = isBeneficiaryFailure(lastFailureReason);
  if (finalIsBeneficiary && order?.id) {
    Promise.resolve(supabaseAdmin.from("orders").update({
      metadata: {
        ...(order.metadata || {}),
        in_beneficiary_queue: true,
        non_beneficiary_failed: true,
        auto_submitted_to_carrier: true,
      },
      failure_reason: `MTN Beneficiary Error: Recipient line is not on carrier whitelist. Auto-submitted for carrier approval and queued. (${lastFailureReason})`
    }).eq("id", order.id)).catch(() => {});
  }

  console.warn(`[HybridRouter] Order ${order.id} was rejected by active provider(s). Retaining in processing queue: ${lastFailureReason}`);
  return {
    ok: false,
    status: "processing",
    provider_order_id: "failed_api_call",
    reason: lastFailureReason,
  };
}
