import { describe, expect, it } from "vitest";
import {
  canClaimDataReward,
  isCashPlayBlocked,
  publicChallenge,
  publicClaim,
  publicResponseBody,
} from "../../supabase/functions/_shared/arena_safety";

const row = {
  id: "c1",
  room_code: "ABC123",
  creator_name: "Kofi",
  creator_phone: "0241234567",
  creator_paystack_ref: "ref_1",
  opponent_phone: "0551234567",
  opponent_paystack_ref: "ref_2",
  winner_phone: "0241234567",
  invited_phone: "0201234567",
  stake_amount: 5,
  metadata: { is_private: true, invited_phone: "0201234567", invited_name: "Ama" },
};

describe("publicChallenge", () => {
  it("removes phone numbers and payment references", () => {
    const safe = publicChallenge(row);
    for (const field of ["creator_phone", "creator_paystack_ref", "opponent_phone", "opponent_paystack_ref", "winner_phone", "invited_phone"]) {
      expect(safe).not.toHaveProperty(field);
    }
    expect(JSON.stringify(safe)).not.toContain("1234567");
  });

  it("keeps what the arena needs to display", () => {
    const safe = publicChallenge(row);
    expect(safe.room_code).toBe("ABC123");
    expect(safe.creator_name).toBe("Kofi");
    expect(safe.metadata).toEqual({ is_private: true, invited_name: "Ama" });
  });

  it("does not change the original row", () => {
    publicChallenge(row);
    expect(row.creator_phone).toBe("0241234567");
    expect(row.metadata.invited_phone).toBe("0201234567");
  });

  it("copes with empty values", () => {
    expect(publicChallenge(null)).toBeNull();
    expect(publicChallenge({ id: "x" })).toEqual({ id: "x" });
  });
});

describe("publicClaim", () => {
  it("removes the winner's private details", () => {
    const safe = publicClaim({ id: "1", winner_name: "Kofi", winner_phone: "024", user_id: "u", order_id: "o", notes: "n", cash_amount: 9 });
    expect(safe).toEqual({ id: "1", winner_name: "Kofi", cash_amount: 9 });
  });
});

describe("publicResponseBody", () => {
  it("cleans challenge and claim data in a response", () => {
    const body = publicResponseBody({
      success: true,
      challenge: row,
      challenges: [row],
      recent_claims: [{ winner_name: "Kofi", winner_phone: "024" }],
    });
    expect(JSON.stringify(body)).not.toContain("1234567");
    expect(JSON.stringify(body)).not.toContain("winner_phone");
    expect(body.success).toBe(true);
  });

  it("leaves other responses alone", () => {
    const body = { success: false, error: "No" };
    expect(publicResponseBody(body)).toEqual(body);
  });
});

describe("isCashPlayBlocked", () => {
  const off = { cash_stakes_enabled: false };
  const on = { cash_stakes_enabled: true };

  it("blocks any stake while cash is off", () => {
    expect(isCashPlayBlocked(off, "p2p", 5)).toBe(true);
  });

  it("blocks cash AI matches while cash is off", () => {
    expect(isCashPlayBlocked(off, "ai", 0)).toBe(true);
  });

  it("treats a missing setting as off", () => {
    expect(isCashPlayBlocked({}, "p2p", 5)).toBe(true);
    expect(isCashPlayBlocked(null, "p2p", 5)).toBe(true);
  });

  it("allows free play while cash is off", () => {
    expect(isCashPlayBlocked(off, "p2p", 0)).toBe(false);
    expect(isCashPlayBlocked(off, "free_data", 0)).toBe(false);
  });

  it("allows stakes only when cash is explicitly on", () => {
    expect(isCashPlayBlocked(on, "p2p", 5)).toBe(false);
    expect(isCashPlayBlocked(on, "ai", 5)).toBe(false);
  });
});

describe("canClaimDataReward", () => {
  it("allows server-checked matches", () => {
    expect(canClaimDataReward({ stake_amount: 0, metadata: { oware_server_checked: true } })).toBe(true);
  });

  it("lets a match that was already staked finish its claim", () => {
    expect(canClaimDataReward({ stake_amount: 5, metadata: {} })).toBe(true);
  });

  it("refuses free matches whose result the server can't verify", () => {
    expect(canClaimDataReward({ stake_amount: 0, metadata: {} })).toBe(false);
    expect(canClaimDataReward({ stake_amount: 0 })).toBe(false);
  });
});
