import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("purchase flow guardrails", () => {
  it("does not perform direct order inserts in public checkout UIs", () => {
    const agentStore = read("src/pages/AgentStore.tsx");

    expect(agentStore).not.toContain('from("orders").insert');
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

  it("uses admin global pricing for wallet buys", () => {
    const walletBuyData = read("supabase/functions/wallet-buy-data/index.ts");
    expect(walletBuyData).toContain("resolveExpectedAmountForUser");
    expect(walletBuyData).toContain("global_package_settings");
    expect(walletBuyData).toContain("agent_price");
  });

  it("lets sub-agents set selling prices above assigned base", () => {
    const dashboardPricing = read("src/pages/DashboardPricing.tsx");
    expect(dashboardPricing).toContain("const isSubAgent");
    expect(dashboardPricing).toContain("sub_agent_prices");
    expect(dashboardPricing).toContain("You can add your own profit above that base");
  });

  it("persists parent commissions for sub-agent sales", () => {
    const initializePayment = read("supabase/functions/initialize-payment/index.ts");
    const verifyPayment = read("supabase/functions/verify-payment/index.ts");
    const webhook = read("supabase/functions/paystack-webhook/index.ts");

    expect(initializePayment).toContain("parent_profit");
    expect(initializePayment).toContain("parent_agent_id");
    expect(verifyPayment).toContain("parent_profit");
    expect(webhook).toContain("parent_profit");
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

  it("uses configured admin pricing in initialize-payment", () => {
    const initializePayment = read("supabase/functions/initialize-payment/index.ts");

    expect(initializePayment).toContain("Package price is not configured");
    expect(initializePayment).toContain("global_package_settings");
    expect(initializePayment).toContain("Invalid wallet top-up amount");
  });

  it("uses verified Paystack metadata fallback in webhook", () => {
    const webhook = read("supabase/functions/paystack-webhook/index.ts");

    expect(webhook).toContain("const verifiedMetadata");
    expect(webhook).toContain("...verifiedMetadata");
    expect(webhook).toContain("metadata?.order_id");
  });

  it("does not block paid-order verification for unauthenticated status checks", () => {
    const verifyPayment = read("supabase/functions/verify-payment/index.ts");

    expect(verifyPayment).toContain("Retry requires authenticated order owner or admin.");
  });

  it("uses public function invoker for initialize/verify checkout flows", () => {
    const buyData = read("src/pages/BuyData.tsx");
    const agentStore = read("src/pages/AgentStore.tsx");
    const agentPending = read("src/pages/AgentPending.tsx");
    const subAgentPending = read("src/pages/SubAgentPending.tsx");
    const dashboardWallet = read("src/pages/DashboardWallet.tsx");

    expect(buyData).toContain("invokePublicFunction(\"initialize-payment\"");
    expect(agentStore).toContain("invokePublicFunction(\"initialize-payment\"");
    expect(agentPending).toContain("invokePublicFunction(\"initialize-payment\"");
    expect(agentPending).toContain("invokePublicFunctionAsUser(\"verify-payment\"");
    expect(subAgentPending).toContain("invokePublicFunction(\"initialize-payment\"");
    expect(subAgentPending).toContain("invokePublicFunctionAsUser(\"verify-payment\"");
    expect(dashboardWallet).toContain("invokePublicFunctionAsUser(\"verify-payment\"");
    expect(dashboardWallet).toContain("invokePublicFunctionAsUser(\"wallet-topup\"");
    expect(dashboardWallet).toContain("invokePublicFunctionAsUser(\"wallet-buy-data\"");
    expect(dashboardWallet).not.toContain("invokePublicFunction(\"initialize-payment\"");
  });
});
