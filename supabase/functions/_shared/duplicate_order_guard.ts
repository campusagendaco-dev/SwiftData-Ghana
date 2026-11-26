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
export const DUPLICATE_PROCESSING_ERROR_CODE = "DUPLICATE_PROCESSING_ORDER";

export interface DuplicateCandidateOrder {
  id: string;
  status?: string | null;
  network?: string | null;
  package_size?: string | null;
  customer_phone?: string | null;
  order_type?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
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
