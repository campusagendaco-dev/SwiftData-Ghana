// Dependency-free Mystery Box rules shared by edge functions (and covered by Vitest).

/** Normalise a Ghana mobile number to local 10-digit form (0XXXXXXXXX), or null if invalid. */
export function toLocalGhPhone(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("233") && digits.length === 12) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9) digits = `0${digits}`;
  return /^0[235]\d{8}$/.test(digits) ? digits : null;
}

export interface PrizeOrderLike {
  id: string;
  agent_id: string | null;
  customer_phone: string | null;
}

export interface MysteryBoxOpenLike {
  order_id: string;
  user_id: string;
  recipient_phone: string;
}

/**
 * A mystery_box_prize order may only be delivered when a server-written open record
 * exists for it and still matches its owner and recipient. Returns a failure reason or null.
 */
export function prizeOrderGuard(order: PrizeOrderLike, open: MysteryBoxOpenLike | null): string | null {
  if (!open || open.order_id !== order.id) return "No mystery box record for this order";
  if (!order.agent_id || order.agent_id !== open.user_id) return "Mystery box owner mismatch";
  if (toLocalGhPhone(order.customer_phone) !== toLocalGhPhone(open.recipient_phone)) {
    return "Mystery box recipient mismatch";
  }
  return null;
}

const ERROR_MESSAGES: Record<string, string> = {
  not_eligible: "You don't have a box to open yet. Keep ordering to unlock one!",
  out_of_stock: "All the prizes for this campaign have been claimed. Watch out for the next one!",
  campaign_closed: "This Mystery Box campaign has ended.",
  invalid_phone: "Enter a valid Ghana number, e.g. 024 123 4567.",
  open_failed: "We couldn't open your box right now. Please try again.",
};

/** Map a mystery_box_open exception message to a client error code + friendly text. */
export function mysteryBoxError(raw: string | null | undefined): { error: string; message: string } {
  const code = Object.keys(ERROR_MESSAGES).find((k) => k !== "open_failed" && String(raw ?? "").includes(k)) ?? "open_failed";
  return { error: code, message: ERROR_MESSAGES[code] };
}
