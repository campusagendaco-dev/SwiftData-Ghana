export const IN_FLIGHT_ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "queued",
  "initiated",
] as const;

export const DELIVERED_ORDER_STATUSES = [
  "fulfilled",
  "completed",
  "delivered",
] as const;

export const TERMINAL_ORDER_STATUSES = [
  "failed",
  "fulfillment_failed",
  "refunded",
  "cancelled",
  "canceled",
  "error",
  "expired",
  "awaiting_payment",
] as const;

export const ACTIVE_DUPLICATE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
export const SIBLING_RACE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes for delivered-during-race check
export const DUPLICATE_PROCESSING_ERROR_CODE = "DUPLICATE_PROCESSING_ORDER";

export interface DuplicateCandidateOrder {
  id: string;
  status?: string | null;
  network?: string | null;
  package_size?: string | null;
  customer_phone?: string | null;
  order_type?: string | null;
  amount?: number | string | null;
  provider_id?: string | null;
  provider_order_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SiblingDispatchDecision {
  action: "allow" | "hold_inflight" | "hold_recent_delivered";
  sibling?: DuplicateCandidateOrder;
  reason?: string;
}

export interface DuplicateCheckTarget {
  phone: string;
  network: string;
  packageSize?: string | null;
  orderType?: string | null;
  amount?: number | null;
  windowMs?: number;
  nowMs?: number;
}

export interface DuplicateCheckResult {
  blocked: boolean;
  existingOrder?: DuplicateCandidateOrder;
  message?: string;
  code?: string;
}

export function normalizeDuplicatePhone(phone: string | null | undefined): string {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 9 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  return digits;
}

export function getPhoneLookupVariants(phone: string | null | undefined): string[] {
  const raw = String(phone || "").trim();
  const normalized = normalizeDuplicatePhone(raw);
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (normalized) {
    variants.add(normalized);
    if (normalized.length === 10 && normalized.startsWith("0")) {
      const local9 = normalized.slice(1);
      variants.add(local9);
      variants.add(`233${local9}`);
      variants.add(`+233${local9}`);
    }
  }
  return Array.from(variants);
}

export function normalizeDuplicateNetwork(network: string | null | undefined): string {
  let n = String(network || "").trim().toUpperCase();
  if (n.startsWith("KORBA")) {
    n = n.replace(/^KORBA\s*/i, "").trim();
  }
  if (n.includes("MASH")) return "MTN MASH UP";
  if (n.includes("TELECEL") || n.includes("VODA") || n.includes("VDF") || n === "RED") return "TELECEL";
  if (n.includes("AIRTEL") || n.includes("TIGO") || n === "AT" || n === "ATL" || n.includes("AT ")) return "AIRTELTIGO";
  if (n.includes("MTN") || n === "YELLO") return "MTN";
  return n;
}

export function normalizeDuplicatePackage(packageSize: string | null | undefined): string {
  return String(packageSize || "").replace(/\s+/g, "").toUpperCase();
}

export function isInFlightOrderStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase();
  return (IN_FLIGHT_ORDER_STATUSES as readonly string[]).includes(s);
}

export function isDeliveredOrTerminalStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase();
  return (
    (DELIVERED_ORDER_STATUSES as readonly string[]).includes(s) ||
    (TERMINAL_ORDER_STATUSES as readonly string[]).includes(s)
  );
}

/**
 * Duplicate Purchase Rule:
 * - BLOCK & INFORM when the same normalized recipient phone already has an active
 *   in-flight / processing order (status IN ('pending', 'paid', 'processing', 'queued', 'initiated'))
 *   for the same network (and same package size for data orders) within the active window.
 * - ALLOW duplicate purchases whenever previous orders for that phone + package are already
 *   delivered ('fulfilled', 'completed', 'delivered') or terminal ('failed', 'fulfillment_failed',
 *   'refunded', 'cancelled', etc.).
 */
export function findBlockingProcessingOrder(
  orders: DuplicateCandidateOrder[] | null | undefined,
  target: DuplicateCheckTarget,
): DuplicateCandidateOrder | null {
  if (!orders || orders.length === 0) return null;

  const targetPhone = normalizeDuplicatePhone(target.phone);
  const targetNetwork = normalizeDuplicateNetwork(target.network);
  const targetPackage = normalizeDuplicatePackage(target.packageSize);
  const targetOrderType = String(target.orderType || "data").trim().toLowerCase();
  const windowMs = target.windowMs ?? ACTIVE_DUPLICATE_WINDOW_MS;
  const nowMs = target.nowMs ?? Date.now();

  if (!targetPhone || !targetNetwork) return null;

  for (const order of orders) {
    if (!isInFlightOrderStatus(order.status)) continue;

    if (order.created_at) {
      const createdMs = Date.parse(order.created_at);
      if (Number.isFinite(createdMs) && nowMs - createdMs > windowMs) {
        continue;
      }
    }

    const orderPhone = normalizeDuplicatePhone(order.customer_phone);
    if (orderPhone !== targetPhone) continue;

    const orderNetwork = normalizeDuplicateNetwork(order.network);
    if (orderNetwork !== targetNetwork) continue;

    if (targetOrderType === "airtime") {
      const candidateType = String(order.order_type || "").trim().toLowerCase();
      if (candidateType && candidateType !== "airtime") continue;
      if (target.amount != null && order.amount != null) {
        if (Math.abs(Number(order.amount) - Number(target.amount)) > 0.01) continue;
      }
      return order;
    }

    if (targetPackage) {
      const orderPackage = normalizeDuplicatePackage(order.package_size);
      if (orderPackage !== targetPackage) continue;
    }

    return order;
  }

  return null;
}

export function formatDuplicateProcessingMessage(
  order: DuplicateCandidateOrder,
  fallback?: { network?: string | null; packageSize?: string | null; phone?: string | null },
): string {
  const net = String(order.network || fallback?.network || "").trim();
  const pkg = String(order.package_size || fallback?.packageSize || "").trim();
  const phone = normalizeDuplicatePhone(order.customer_phone || fallback?.phone || "");
  const shortId = String(order.id || "").trim().slice(0, 8).toUpperCase();

  const itemDesc = [net, pkg].filter(Boolean).join(" ").trim() || "data";
  const phonePart = phone ? ` for ${phone}` : "";
  const orderRef = shortId ? ` (Order #${shortId})` : "";

  return `You already have a processing ${itemDesc} order${phonePart}${orderRef}. Please wait for it to be delivered before placing another order.`;
}

export async function checkActiveProcessingDuplicate(
  supabaseClient: any,
  target: DuplicateCheckTarget,
): Promise<DuplicateCheckResult> {
  const normalizedPhone = normalizeDuplicatePhone(target.phone);
  const normalizedNetwork = normalizeDuplicateNetwork(target.network);
  if (!normalizedPhone || !normalizedNetwork) {
    return { blocked: false };
  }

  const phoneVariants = getPhoneLookupVariants(target.phone);
  const windowMs = target.windowMs ?? ACTIVE_DUPLICATE_WINDOW_MS;
  const nowMs = target.nowMs ?? Date.now();
  const windowStartIso = new Date(nowMs - windowMs).toISOString();

  const { data: recentOrders, error } = await supabaseClient
    .from("orders")
    .select("id, status, network, package_size, customer_phone, order_type, amount, created_at")
    .in("customer_phone", phoneVariants)
    .in("status", [...IN_FLIGHT_ORDER_STATUSES])
    .gte("created_at", windowStartIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[DUPLICATE_GUARD] Lookup failed, allowing order to proceed:", error.message || error);
    return { blocked: false };
  }

  const blocking = findBlockingProcessingOrder(recentOrders, {
    ...target,
    windowMs,
    nowMs,
  });

  if (!blocking) {
    return { blocked: false };
  }

  return {
    blocked: true,
    existingOrder: blocking,
    code: DUPLICATE_PROCESSING_ERROR_CODE,
    message: formatDuplicateProcessingMessage(blocking, {
      network: target.network,
      packageSize: target.packageSize,
      phone: normalizedPhone,
    }),
  };
}

export function isDuplicateProcessingDbError(
  err: { message?: string | null; code?: string | null; details?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  return String(err.message || "").includes(DUPLICATE_PROCESSING_ERROR_CODE);
}

export function parseDuplicateProcessingDbError(
  err: { message?: string | null; details?: string | null } | null | undefined,
): { message: string; existingOrderId?: string } {
  const rawMessage = String(err?.message || "");
  const cleanedMessage = rawMessage
    .replace(/^.*DUPLICATE_PROCESSING_ORDER:\s*/i, "")
    .trim();
  const detailMatch = String(err?.details || "").match(/existing_order_id=([0-9a-f-]{36})/i);
  return {
    message: cleanedMessage || "You already have a processing order for this recipient. Please wait for it to be delivered before placing another order.",
    existingOrderId: detailMatch?.[1],
  };
}

/**
 * Decide whether verify-payment may dispatch `currentOrder` to an upstream provider
 * given candidate sibling orders for the same phone.
 *
 * Rules:
 * - Only inspects older siblings (created_at < current.created_at, or equal created_at with smaller id)
 *   matching normalized phone, normalized network, and normalized package_size (plus amount for airtime).
 * - If an older sibling is currently in-flight (pending, paid, processing, queued, initiated) within
 *   the active 60-minute window -> `hold_inflight` (MUST NOT dispatch concurrently!).
 * - If an older sibling is already delivered (fulfilled/completed/delivered):
 *     * If it was delivered BEFORE `currentOrder` was created (`sibling.updated_at < currentOrder.created_at`),
 *       this is a deliberate repeat purchase -> `allow`!
 *     * If `currentOrder` was created while the older sibling was still in-flight
 *       (`currentOrder.created_at <= sibling.updated_at`) and within `SIBLING_RACE_WINDOW_MS` (2 min)
 *       of `sibling.created_at` -> `hold_recent_delivered` (race duplicate, MUST NOT double-deliver!).
 */
export function evaluateSiblingDispatchGuard(
  currentOrder: {
    id: string;
    customer_phone?: string | null;
    network?: string | null;
    package_size?: string | null;
    order_type?: string | null;
    amount?: number | string | null;
    created_at?: string | null;
  },
  siblings: DuplicateCandidateOrder[] | null | undefined,
  opts?: {
    inFlightWindowMs?: number;
    deliveredRaceWindowMs?: number;
    nowMs?: number;
  },
): SiblingDispatchDecision {
  if (!siblings || siblings.length === 0) return { action: "allow" };

  const targetPhone = normalizeDuplicatePhone(currentOrder.customer_phone);
  const targetNetwork = normalizeDuplicateNetwork(currentOrder.network);
  const targetPackage = normalizeDuplicatePackage(currentOrder.package_size);
  const targetType = String(currentOrder.order_type || "data").trim().toLowerCase();
  const currentCreatedMs = currentOrder.created_at ? Date.parse(currentOrder.created_at) : NaN;
  const nowMs = opts?.nowMs ?? Date.now();
  const inFlightWindowMs = opts?.inFlightWindowMs ?? ACTIVE_DUPLICATE_WINDOW_MS;
  const deliveredRaceWindowMs = opts?.deliveredRaceWindowMs ?? SIBLING_RACE_WINDOW_MS;

  if (!targetPhone || !targetNetwork) return { action: "allow" };

  for (const sibling of siblings) {
    if (!sibling?.id || sibling.id === currentOrder.id) continue;

    if (normalizeDuplicatePhone(sibling.customer_phone) !== targetPhone) continue;
    if (normalizeDuplicateNetwork(sibling.network) !== targetNetwork) continue;

    if (targetType === "airtime") {
      const sibType = String(sibling.order_type || "").trim().toLowerCase();
      if (sibType && sibType !== "airtime") continue;
      if (currentOrder.amount != null && sibling.amount != null) {
        if (Math.abs(Number(sibling.amount) - Number(currentOrder.amount)) > 0.01) continue;
      }
    } else if (targetPackage) {
      if (normalizeDuplicatePackage(sibling.package_size) !== targetPackage) continue;
    }

    const siblingCreatedMs = sibling.created_at ? Date.parse(sibling.created_at) : NaN;
    const isOlder =
      Number.isFinite(siblingCreatedMs) && Number.isFinite(currentCreatedMs)
        ? siblingCreatedMs < currentCreatedMs ||
          (siblingCreatedMs === currentCreatedMs && sibling.id < currentOrder.id)
        : sibling.id < currentOrder.id;

    if (!isOlder) continue;

    const sibStatus = String(sibling.status || "").trim().toLowerCase();

    // 1. Older sibling is still in-flight -> NEVER dispatch a second concurrent order.
    if (isInFlightOrderStatus(sibStatus)) {
      if (!Number.isFinite(siblingCreatedMs) || nowMs - siblingCreatedMs <= inFlightWindowMs) {
        return {
          action: "hold_inflight",
          sibling,
          reason: `Blocked concurrent dispatch: older sibling order #${sibling.id.slice(0, 8).toUpperCase()} is currently ${sibStatus}${sibling.provider_order_id ? ` (${sibling.provider_order_id})` : ""}.`,
        };
      }
      continue;
    }

    // 2. Older sibling is already delivered: allow deliberate repeat purchases placed AFTER delivery,
    //    but block if currentOrder was created while the older sibling was still in-flight (within race window).
    if ((DELIVERED_ORDER_STATUSES as readonly string[]).includes(sibStatus)) {
      const siblingUpdatedMs = sibling.updated_at ? Date.parse(sibling.updated_at) : NaN;
      const withinRaceWindow =
        Number.isFinite(siblingCreatedMs) &&
        Number.isFinite(currentCreatedMs) &&
        currentCreatedMs - siblingCreatedMs <= deliveredRaceWindowMs;
      const createdBeforeSiblingDelivered =
        Number.isFinite(siblingUpdatedMs) &&
        Number.isFinite(currentCreatedMs) &&
        currentCreatedMs <= siblingUpdatedMs;

      if (withinRaceWindow && createdBeforeSiblingDelivered) {
        return {
          action: "hold_recent_delivered",
          sibling,
          reason: `Blocked double-delivery race: order was created while sibling #${sibling.id.slice(0, 8).toUpperCase()} was still in-flight and has since been delivered.`,
        };
      }
    }
  }

  return { action: "allow" };
}
