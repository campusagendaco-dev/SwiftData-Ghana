// Frontend copy of confirmKindFor() in supabase/functions/_shared/agent_policy.ts (the
// browser can't import Deno files). Keep the two tables the same; the agent approval queue
// test checks a sample of each kind.
const KIND: Record<string, "account" | "ops" | "message"> = {
  suspend_agent: "account",
  suspend_cluster: "account",
  suspend_login_bot: "account",
  suspend_referral_ring: "account",
  blacklist_ip: "account",
  freeze_cashouts: "account",
  lock_terminal: "account",
  switch_priority: "ops",
  rebalance_sme_provider: "ops",
  self_heal_provider: "ops",
  disable_network: "ops",
  quarantine_order: "ops",
  relink_order_provider: "ops",
  broadcast_outage: "message",
};

export function agentConfirmKind(taskType: string): "account" | "ops" | "message" {
  return KIND[String(taskType || "").trim().toLowerCase()] ?? "ops";
}
