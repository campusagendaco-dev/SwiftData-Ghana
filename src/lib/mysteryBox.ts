// Client-side Mystery Box display rules.

export type MysteryProgress = {
  qualifying_orders: number;
  boxes_earned: number;
  boxes_opened: number;
  boxes_available: number;
  orders_to_next: number;
};

export type BoxState = "locked" | "available" | "done";

export function boxState(p: MysteryProgress, maxBoxes: number): BoxState {
  if (p.boxes_available > 0) return "available";
  if (p.boxes_opened >= maxBoxes) return "done";
  return "locked";
}

export function progressLine(p: MysteryProgress, ordersPerBox: number): string {
  const towardNext = Math.min(Math.max(p.qualifying_orders - p.boxes_earned * ordersPerBox, 0), ordersPerBox);
  return `Progress: ${towardNext}/${ordersPerBox} qualifying orders · ${p.orders_to_next} more to unlock`;
}

export function lockedButtonLabel(y: number): string {
  return `Place ${y} order${y === 1 ? "" : "s"} to unlock`;
}

export function dismissKey(campaignId: string): string {
  return `swift_mystery_box_dismissed_${campaignId}`;
}

/** Show unless dismissed this session — but show again once more boxes are available than at dismissal. */
export function shouldAutoShow(
  campaignId: string,
  boxesAvailable: number,
  storage: Pick<Storage, "getItem"> | null,
): boolean {
  try {
    const stored = storage?.getItem(dismissKey(campaignId));
    if (stored == null) return true;
    const atDismiss = Number(stored);
    return !Number.isFinite(atDismiss) || boxesAvailable > atDismiss;
  } catch {
    return true;
  }
}

export function rememberDismiss(
  campaignId: string,
  boxesAvailable: number,
  storage: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(dismissKey(campaignId), String(boxesAvailable));
  } catch {
    /* storage blocked — nothing to remember */
  }
}

/** Each prize's chance (%) of being picked, to one decimal; inactive prizes get 0. */
export function oddsPercent(prizes: { weight: number; is_active: boolean }[]): number[] {
  const total = prizes.reduce((sum, p) => sum + (p.is_active ? Math.max(p.weight, 0) : 0), 0);
  return prizes.map((p) => (p.is_active && total > 0 ? Math.round((Math.max(p.weight, 0) / total) * 1000) / 10 : 0));
}
