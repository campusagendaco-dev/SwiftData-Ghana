// Rules for what the Game Arena may expose publicly and when cash play is allowed.
// No imports, so both Deno and the Vitest suite can load this file.

const PRIVATE_CHALLENGE_FIELDS = [
  "creator_phone",
  "creator_paystack_ref",
  "opponent_phone",
  "opponent_paystack_ref",
  "winner_phone",
  "invited_phone",
];

const PRIVATE_CLAIM_FIELDS = ["winner_phone", "user_id", "order_id", "notes"];

export const CASH_STAKES_PAUSED_MESSAGE =
  "Cash stakes are paused while we upgrade fairness checks. You can still play free matches and earn Arena Points.";

type Row = Record<string, any>;

const without = (row: Row, fields: string[]): Row => {
  const copy = { ...row };
  for (const field of fields) delete copy[field];
  return copy;
};

export function publicChallenge(row: Row | null | undefined): Row | null | undefined {
  if (!row) return row;
  const safe = without(row, PRIVATE_CHALLENGE_FIELDS);
  if (safe.metadata && typeof safe.metadata === "object") {
    safe.metadata = without(safe.metadata, ["invited_phone"]);
  }
  return safe;
}

export function publicClaim(row: Row): Row {
  return without(row, PRIVATE_CLAIM_FIELDS);
}

/** Removes private fields from any response that carries challenge or claim rows. */
export function publicResponseBody(body: Row): Row {
  const safe = { ...body };
  if (safe.challenge) safe.challenge = publicChallenge(safe.challenge);
  if (Array.isArray(safe.challenges)) safe.challenges = safe.challenges.map(publicChallenge);
  if (Array.isArray(safe.recent_claims)) safe.recent_claims = safe.recent_claims.map(publicClaim);
  return safe;
}

export function isCashPlayBlocked(settings: Row | null | undefined, mode: string, stake: number): boolean {
  if (settings?.cash_stakes_enabled === true) return false;
  return stake > 0 || mode === "ai";
}

/** Free matches can only earn a data reward when the server verified the result. */
export function canClaimDataReward(challenge: Row): boolean {
  return Number(challenge.stake_amount || 0) > 0 || challenge.metadata?.oware_server_checked === true;
}
