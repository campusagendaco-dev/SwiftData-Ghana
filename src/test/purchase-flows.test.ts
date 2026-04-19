import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("purchase flow guardrails", () => {
  it("does not perform direct order inserts in public checkout UIs", () => {
    const agentStore = read("src/pages/AgentStore.tsx");
    const afaOrderForm = read("src/components/AfaOrderForm.tsx");

    expect(agentStore).not.toContain('from("orders").insert');
    expect(afaOrderForm).not.toContain('from("orders").insert');
  });

  it("keeps webhook idempotent for already fulfilled orders", () => {
    const webhook = read("supabase/functions/paystack-webhook/index.ts");
    expect(webhook).toContain('if (existingOrder?.status === "fulfilled")');
  });

  it("uses wallet credit metadata when recreating topup orders", () => {
    const webhook = read("supabase/functions/paystack-webhook/index.ts");
    expect(webhook).toContain("metadata?.wallet_credit");
    expect(webhook).toContain("orderTypeFromMetadata");
  });

  it("uses resolved agent attribution in verify flow", () => {
    const verifyPayment = read("supabase/functions/verify-payment/index.ts");
    expect(verifyPayment).toContain("const resolvedAgentId");
    expect(verifyPayment).toContain('eq("agent_id", resolvedAgentId)');
  });

  it("stores profit metadata in initialize-payment order records", () => {
    const initializePayment = read("supabase/functions/initialize-payment/index.ts");
    expect(initializePayment).toContain("normalizedProfit");
    expect(initializePayment).toContain("profit: normalizedProfit");
  });

  it("enforces assigned parent pricing for sub-agent wallet buys", () => {
    const walletBuyData = read("supabase/functions/wallet-buy-data/index.ts");
    expect(walletBuyData).toContain("resolveExpectedAmountForUser");
    expect(walletBuyData).toContain("is_sub_agent");
    expect(walletBuyData).toContain("agent_prices");
  });

  it("uses assigned sub-agent pricing in dashboard wallet UI", () => {
    const dashboardWallet = read("src/pages/DashboardWallet.tsx");
    expect(dashboardWallet).toContain("getAssignedSubAgentPrice");
    expect(dashboardWallet).toContain("profile?.is_sub_agent");
  });

  it("rejects amount mismatch during verify and webhook fulfillment", () => {
    const verifyPayment = read("supabase/functions/verify-payment/index.ts");
    const webhook = read("supabase/functions/paystack-webhook/index.ts");

    expect(verifyPayment).toContain("Payment amount mismatch");
    expect(webhook).toContain("Payment amount mismatch");
  });

  it("caps recreated wallet topup credit by verified amount", () => {
    const verifyPayment = read("supabase/functions/verify-payment/index.ts");
    const webhook = read("supabase/functions/paystack-webhook/index.ts");

    expect(verifyPayment).toContain("Math.min(requestedWalletCredit, verifiedAmount)");
    expect(webhook).toContain("Math.min(requestedWalletCredit, verifiedAmount)");
  });

  it("validates initialize-payment amount server-side", () => {
    const initializePayment = read("supabase/functions/initialize-payment/index.ts");

    expect(initializePayment).toContain("Invalid amount for");
    expect(initializePayment).toContain("Invalid wallet top-up amount");
  });
});
