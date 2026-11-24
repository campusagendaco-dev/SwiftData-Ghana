// Ama's welcome tour for new users: a few short stops with a "Show me" button each.
// Shown once to accounts created in the last 7 days, and any time from Ama's chat.

export const TOUR_NEW_ACCOUNT_DAYS = 7;
export const TOUR_START_EVENT = "ama:start-tour";

export type TourStep = { title: string; text: string; path: string | null };

export function shouldShowTour(input: { userCreatedAt: string | null | undefined; done: boolean; now: Date; requested?: boolean }): boolean {
  if (input.requested) return true;
  if (input.done || !input.userCreatedAt) return false;
  const created = new Date(input.userCreatedAt).getTime();
  if (Number.isNaN(created)) return false;
  return input.now.getTime() - created <= TOUR_NEW_ACCOUNT_DAYS * 86_400_000;
}

export function tourSteps(role: { isAgent: boolean; isSubAgent: boolean }): TourStep[] {
  const sells = role.isAgent || role.isSubAgent;
  const steps: TourStep[] = [
    { title: "Akwaaba! I'm Ama 👋", text: "Let me show you around SwiftData. It takes about a minute, and you can skip any time.", path: null },
    { title: "Your wallet", text: "Top up with MoMo or card, then pay for bundles in one tap.", path: "/dashboard/wallet" },
    { title: "Buy data", text: "MTN, Telecel and AirtelTigo bundles for any number, delivered in seconds.", path: "/dashboard/buy-data" },
    { title: "Airtime and bills", text: "Buy airtime and pay bills like electricity from the same wallet.", path: "/dashboard/buy-airtime" },
    { title: "Your orders", text: "Every order and its status in one place.", path: "/dashboard/transactions" },
  ];
  if (sells) {
    steps.push(
      { title: "Your store", text: "Your own shop link: customers buy from you and you keep the profit.", path: "/dashboard/my-store" },
      { title: "Your customers", text: "See who buys from you and how much.", path: "/dashboard/customers" },
      { title: "Your prices", text: "Check your agent prices for every bundle.", path: "/dashboard/agent-prices" },
      { title: "Cash out", text: "Withdraw your profits to MoMo.", path: "/dashboard/withdrawals" },
      { title: "Flyers", text: "Make a promo flyer to share on WhatsApp Status.", path: "/dashboard/flyer" },
    );
  }
  if (role.isAgent) {
    steps.push({ title: "Sub-agents", text: "Build a team under you and earn on their sales too.", path: "/dashboard/subagents" });
  }
  if (!sells) {
    steps.push({ title: "Invite friends", text: "Share your referral link and earn when friends buy.", path: "/dashboard/referral" });
  }
  steps.push(
    { title: "Something wrong?", text: "Report an issue here and our team will follow up.", path: "/dashboard/report-issue" },
    { title: "Just ask me", text: "Tap my bubble any time: balances, prices, orders, or buying a bundle. I'll always check with you before buying.", path: null },
  );
  return steps;
}
