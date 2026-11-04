import type { ComponentType } from "react";
import {
  Bell,
  Bot,
  CalendarClock,
  ClipboardList,
  CodeXml,
  CreditCard,
  FileText,
  Flag,
  Gift,
  GraduationCap,
  HandCoins,
  Home,
  Key,
  LayoutDashboard,
  Megaphone,
  Phone,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Store,
  Tags,
  Trophy,
  User,
  UserCog,
  Users2,
  Wallet,
  Zap,
  BookUser,
  Medal,
} from "lucide-react";

export type NavIcon = ComponentType<{ className?: string }>;

export interface NavCtx {
  isPaidAgent: boolean;
  hasStore: boolean;
  isSubAgentOnly: boolean;
  apiPartner: boolean;
}

export interface NavItem {
  to: string;
  label: string;
  icon: NavIcon;
  /** extra paths that should highlight this item */
  match?: (path: string) => boolean;
  badge?: "new";
  keywords?: string;
  visible?: (c: NavCtx) => boolean;
  labelFor?: (c: NavCtx) => string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
  visible?: (c: NavCtx) => boolean;
}

const agentOnly = (c: NavCtx) => c.isPaidAgent;
const agentWithStore = (c: NavCtx) => c.isPaidAgent && c.hasStore;
const parentAgentWithStore = (c: NavCtx) => c.isPaidAgent && c.hasStore && !c.isSubAgentOnly;

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Home", icon: LayoutDashboard, keywords: "overview dashboard" },
      { to: "/dashboard/notifications", label: "Inbox", icon: Bell, keywords: "notifications messages" },
    ],
  },
  {
    id: "sell",
    label: "Sell",
    items: [
      {
        to: "/dashboard/buy-data/mtn",
        label: "Buy data",
        icon: ShoppingCart,
        match: (p) => p.startsWith("/dashboard/buy-data"),
        keywords: "bundle mtn telecel airteltigo",
      },
      { to: "/dashboard/buy-airtime", label: "Buy airtime", icon: Smartphone, keywords: "credit topup" },
      { to: "/dashboard/utilities", label: "Utility bills", icon: Zap, keywords: "ecg electricity water dstv" },
      { to: "/dashboard/afa", label: "AFA registration", icon: ShieldCheck, keywords: "afa sim" },
      { to: "/dashboard/result-checker", label: "Result checker", icon: GraduationCap, keywords: "waec bece wassce", visible: agentOnly },
      { to: "/dashboard/bulk", label: "Bulk send", icon: Send, keywords: "bulk disbursement", visible: agentOnly },
      { to: "/dashboard/schedule", label: "Auto-renewal", icon: CalendarClock, keywords: "schedule recurring" },
      { to: "/dashboard/customers", label: "Customers", icon: BookUser, keywords: "address book contacts saved" },
      {
        to: "/dashboard/submit-numbers",
        label: "Verify numbers",
        icon: Phone,
        keywords: "submit check beneficiary",
        match: (p) => ["/dashboard/submit-numbers", "/dashboard/verify-numbers", "/dashboard/check-numbers", "/dashboard/submit-beneficiary"].includes(p),
      },
    ],
  },
  {
    id: "money",
    label: "Money",
    items: [
      { to: "/dashboard/wallet", label: "Wallet", icon: Wallet, keywords: "balance top up deposit" },
      { to: "/dashboard/transactions", label: "Transactions", icon: ClipboardList, keywords: "orders history", match: (p) => p === "/dashboard/transactions" || p === "/dashboard/orders" },
      { to: "/dashboard/withdrawals", label: "Withdrawals", icon: HandCoins, keywords: "cash out payout momo", visible: agentOnly, match: (p) => p === "/dashboard/withdrawals" || p === "/dashboard/withdraw" },
      { to: "/dashboard/refunded-orders", label: "Refunds", icon: RotateCcw, keywords: "refunded orders", match: (p) => p === "/dashboard/refunded-orders" || p === "/dashboard/refunds" },
      { to: "/dashboard/direct-debit", label: "MTN Direct Debit", icon: CreditCard, keywords: "auto debit momo" },
    ],
  },
  {
    id: "business",
    label: "My business",
    visible: agentOnly,
    items: [
      { to: "/dashboard/my-store", label: "My store", icon: Store, keywords: "shop storefront", visible: (c) => c.hasStore },
      { to: "/dashboard/store-settings", label: "Store settings", icon: Settings, keywords: "branding logo", visible: agentWithStore },
      {
        to: "/dashboard/agent-prices",
        label: "Prices",
        icon: Tags,
        keywords: "agent prices markup",
        labelFor: (c) => (c.apiPartner ? "API prices" : "Prices"),
        match: (p) => p === "/dashboard/agent-prices" || p === "/dashboard/pricing" || p === "/dashboard/cheaper-prices",
      },
      { to: "/dashboard/subagents", label: "Sub-agents", icon: Users2, keywords: "team resellers", visible: parentAgentWithStore, match: (p) => p === "/dashboard/subagents" || p === "/dashboard/sub-agents" },
      { to: "/dashboard/subagent-pricing", label: "Sub-agent pricing", icon: SlidersHorizontal, keywords: "team prices", visible: parentAgentWithStore },
      { to: "/dashboard/marketing", label: "Marketing", icon: Megaphone, keywords: "promote campaigns" },
      { to: "/dashboard/flyer", label: "Flyer maker", icon: FileText, keywords: "poster design" },
      { to: "/dashboard/swift-vendor", label: "Swift Vendor", icon: Zap, keywords: "vendor", badge: "new" },
      { to: "/dashboard/whatsapp-bot", label: "WhatsApp bot", icon: Bot, keywords: "chatbot automation", visible: agentWithStore },
      { to: "/dashboard/leaderboard", label: "Leaderboard", icon: Medal, keywords: "ranking top agents" },
    ],
  },
  {
    id: "developers",
    label: "Developers",
    visible: agentOnly,
    items: [
      { to: "/dashboard/api", label: "API keys", icon: Key, keywords: "api access integration" },
      { to: "/dashboard/agent-dev-hub", label: "Developer hub", icon: CodeXml, keywords: "docs webhooks" },
    ],
  },
  {
    id: "community",
    label: "Community",
    items: [
      { to: "/dashboard/challenges", label: "Game arena", icon: Trophy, keywords: "games challenges win data", match: (p) => p.startsWith("/dashboard/challenges") || p.startsWith("/dashboard/games") },
      { to: "/dashboard/referral", label: "Refer & earn", icon: Gift, keywords: "referral invite" },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { to: "/dashboard/profile", label: "Profile", icon: User, keywords: "me avatar" },
      { to: "/dashboard/account-settings", label: "Security", icon: UserCog, keywords: "password 2fa passkey settings", match: (p) => p === "/dashboard/account-settings" || p === "/dashboard/settings" },
      { to: "/dashboard/report-issue", label: "Report an issue", icon: Flag, keywords: "support help complaint" },
    ],
  },
];

export function buildNavCtx(profile: any): NavCtx {
  const isPaidAgent = Boolean(profile?.agent_approved || profile?.sub_agent_approved || profile?.api_access_enabled);
  return {
    isPaidAgent,
    hasStore: Boolean(profile?.store_name && String(profile.store_name).trim() !== ""),
    isSubAgentOnly: Boolean(profile?.is_sub_agent && !profile?.is_agent),
    apiPartner: Boolean(profile?.api_access_enabled),
  };
}

export function visibleGroups(ctx: NavCtx): NavGroup[] {
  return NAV_GROUPS.filter((g) => !g.visible || g.visible(ctx))
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.visible || i.visible(ctx)) }))
    .filter((g) => g.items.length > 0);
}

export function isItemActive(item: NavItem, path: string) {
  const p = path.replace(/\/+$/, "") || "/";
  return item.match ? item.match(p) : p === item.to;
}

export function findActive(path: string, groups: NavGroup[] = NAV_GROUPS): { group: NavGroup; item: NavItem } | null {
  for (const g of groups) for (const i of g.items) if (isItemActive(i, path)) return { group: g, item: i };
  return null;
}

export function itemLabel(item: NavItem, ctx: NavCtx) {
  return item.labelFor ? item.labelFor(ctx) : item.label;
}

export const HOME_ICON = Home;
