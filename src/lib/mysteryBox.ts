// Client-side Mystery Box display rules (daily box).

export type MysteryProgress = {
  qualifying_orders: number;
  boxes_earned: number;
  boxes_opened: number;
  boxes_available: number;
  orders_to_next: number;
  /** The server's "today" (Ghana time = UTC), YYYY-MM-DD. */
  today: string;
};

export type BoxState = "locked" | "available" | "done";

export const DONE_TODAY_TEXT = "You've opened today's box. Come back tomorrow!";
export const READY_TEXT = "Your box is ready to open! 🎁";

export function boxState(p: MysteryProgress, boxesPerDay: number): BoxState {
  if (p.boxes_available > 0) return "available";
  if (p.boxes_opened >= boxesPerDay) return "done";
  return "locked";
}

export function progressLine(p: MysteryProgress, target: number): string {
  const towardNext = Math.min(Math.max(p.qualifying_orders - p.boxes_earned * target, 0), target);
  return `Today: ${towardNext}/${target} orders · ${p.orders_to_next} more to unlock`;
}

export function lockedButtonLabel(y: number, rewardText: string): string {
  return `Complete ${y} more order${y === 1 ? "" : "s"} today to earn ${rewardText}`;
}

/** Per user (shared shop phones switch accounts), per campaign, per day. */
export function seenKey(userId: string, campaignId: string, day: string): string {
  return `swift_mystery_box_seen_${userId}_${campaignId}_${day}`;
}

// Fallback for when storage is missing or blocked (private mode), so the popup doesn't reopen
// on every page change within this tab.
const seenInMemory = new Map<string, number>();

function readSeen(key: string, storage: Pick<Storage, "getItem"> | null): number {
  let stored = 0;
  try {
    const raw = storage?.getItem(key);
    const n = raw == null ? 0 : Number(raw);
    stored = Number.isFinite(n) ? n : 0;
  } catch {
    /* storage blocked */
  }
  return Math.max(stored, seenInMemory.get(key) ?? 0);
}

/** Pop up when today's delivered-order count is above what the customer last saw. */
export function shouldPopUp(
  userId: string,
  campaignId: string,
  day: string,
  count: number,
  storage: Pick<Storage, "getItem"> | null,
): boolean {
  if (count <= 0) return false;
  return count > readSeen(seenKey(userId, campaignId, day), storage);
}

export function rememberSeen(
  userId: string,
  campaignId: string,
  day: string,
  count: number,
  storage: Pick<Storage, "setItem"> | null,
): void {
  const key = seenKey(userId, campaignId, day);
  seenInMemory.set(key, Math.max(count, seenInMemory.get(key) ?? 0));
  try {
    storage?.setItem(key, String(count));
  } catch {
    /* storage blocked — memory fallback above */
  }
}

/** Each prize's chance (%) of being picked, to one decimal; inactive prizes get 0. */
export function oddsPercent(prizes: { weight: number; is_active: boolean }[]): number[] {
  const total = prizes.reduce((sum, p) => sum + (p.is_active ? Math.max(p.weight, 0) : 0), 0);
  return prizes.map((p) => (p.is_active && total > 0 ? Math.round((Math.max(p.weight, 0) / total) * 1000) / 10 : 0));
}

/** Bundle size in GB ("5GB" → 5, "512MB" → 0.5, "1TB" → 1024), or null if it can't be read. */
export function packageSizeGb(size: string | null | undefined): number | null {
  const match = String(size ?? "").trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (match[2] === "MB") return value / 1024;
  if (match[2] === "TB") return value * 1024;
  return value;
}
