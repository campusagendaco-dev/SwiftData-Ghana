import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getSafeAvatarUrl } from "@/lib/avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildNavCtx,
  isItemActive,
  itemLabel,
  visibleGroups,
  type NavCtx,
  type NavItem,
} from "@/components/dashboard/navConfig";

const FAV_KEY = "swiftdash_favourites_v1";
const GROUPS_KEY = "swiftdash_closed_groups_v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

interface DashboardSidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const DashboardSidebar = ({ open, onClose, collapsed = false, onToggleCollapsed }: DashboardSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, user: authUser, openAccountSwitcher, savedAccounts } = useAuth();
  const ctx: NavCtx = useMemo(() => buildNavCtx(profile), [profile]);
  const groups = useMemo(() => visibleGroups(ctx), [ctx]);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>(() => readJson<string[]>(FAV_KEY, []));
  const [closedGroups, setClosedGroups] = useState<string[]>(() => readJson<string[]>(GROUPS_KEY, []));
  const [parentStore, setParentStore] = useState<{ store_name: string | null; store_logo_url: string | null } | null>(null);

  // On desktop the rail can be icon-only; the mobile drawer is always full width.
  const rail = collapsed && !open;

  useEffect(() => {
    let cancelled = false;
    if (profile?.is_sub_agent && profile.parent_agent_id) {
      supabase
        .from("agent_stores")
        .select("store_name, store_logo_url")
        .eq("user_id", profile.parent_agent_id)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled && data) setParentStore(data as any);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [profile?.is_sub_agent, profile?.parent_agent_id]);

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const favItems = useMemo(() => favs.map((to) => allItems.find((i) => i.to === to)).filter(Boolean) as NavItem[], [favs, allItems]);

  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => `${itemLabel(i, ctx)} ${i.keywords || ""} ${g.label}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length);
  }, [groups, q, ctx]);

  const toggleFav = (to: string) => {
    setFavs((prev) => {
      const next = prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to].slice(-6);
      writeJson(FAV_KEY, next);
      return next;
    });
  };
  const toggleGroup = (id: string) => {
    setClosedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeJson(GROUPS_KEY, next);
      return next;
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const firstName = profile?.full_name?.split(" ")[0] || "Agent";
  const tierLabel = ctx.apiPartner ? "API partner" : ctx.isPaidAgent ? "Pro agent" : "Member";
  const brandName = parentStore?.store_name || "SwiftData";

  const renderItem = (item: NavItem, opts: { inFavs?: boolean } = {}) => {
    const active = isItemActive(item, location.pathname);
    const label = itemLabel(item, ctx);
    const isFav = favs.includes(item.to);
    const link = (
      <Link
        to={item.to}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/item relative flex items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          rail ? "h-10 w-10 justify-center mx-auto" : "h-9 px-2.5",
          active
            ? "bg-foreground/[0.06] text-foreground dark:bg-white/[0.08]"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-white/[0.05]"
        )}
      >
        {active && !rail ? <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-primary" aria-hidden /> : null}
        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground/80 group-hover/item:text-foreground")} />
        {!rail && <span className="truncate flex-1">{label}</span>}
        {!rail && item.badge === "new" && !opts.inFavs ? (
          <span className="rounded-md bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ring-1 ring-inset ring-emerald-500/25">New</span>
        ) : null}
        {!rail ? (
          <button
            type="button"
            aria-label={isFav ? `Unpin ${label}` : `Pin ${label}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFav(item.to);
            }}
            className={cn(
              "h-6 w-6 -mr-1 rounded-md flex items-center justify-center transition-opacity hover:bg-foreground/10",
              isFav ? "opacity-100" : "opacity-0 group-hover/item:opacity-60 focus-visible:opacity-100"
            )}
          >
            <Star className={cn("h-3.5 w-3.5", isFav ? "fill-primary text-primary" : "text-muted-foreground")} />
          </button>
        ) : null}
      </Link>
    );
    if (!rail) return <li key={item.to}>{link}</li>;
    return (
      <li key={item.to}>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-[999] bg-black/50 backdrop-blur-[2px] md:hidden transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        aria-label="Dashboard navigation"
        className={cn(
          "fixed md:sticky top-0 left-0 z-[1000] h-[100dvh] shrink-0 flex flex-col",
          "bg-background md:bg-background/40 md:backdrop-blur-xl border-r border-border/70 dark:border-white/[0.06]",
          "transition-[transform,width] duration-200 ease-out md:translate-x-0",
          "w-[284px]", open ? "translate-x-0 shadow-2xl md:shadow-none" : "-translate-x-full",
          rail ? "md:w-[72px]" : "md:w-[260px]"
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        {/* Brand */}
        <div className={cn("h-16 shrink-0 flex items-center", rail ? "justify-center px-2" : "px-4 gap-3")}>
          <Link to="/dashboard" onClick={onClose} className="flex items-center gap-2.5 min-w-0">
            <span className="h-8 w-8 shrink-0 rounded-lg overflow-hidden bg-white ring-1 ring-black/5 flex items-center justify-center">
              <img src={parentStore?.store_logo_url || "/logo.png"} alt="" className="h-full w-full object-contain" />
            </span>
            {!rail && (
              <span className="min-w-0 leading-tight">
                <span className="block text-[15px] font-bold tracking-[-0.01em] text-foreground truncate">{brandName}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{parentStore ? "Reseller partner" : "Agent console"}</span>
              </span>
            )}
          </Link>
          {!rail && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="md:hidden ml-auto h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Search */}
        {!rail && (
          <div className="px-3 pb-2 shrink-0">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to…"
                aria-label="Filter menu"
                className="h-9 w-full rounded-lg border border-border/80 bg-card pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:ring-2 focus:ring-primary/40 dark:bg-white/[0.03] dark:border-white/[0.08]"
              />
            </label>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 no-scrollbar" style={{ WebkitOverflowScrolling: "touch" }}>
          {!q && favItems.length > 0 && (
            <div className="pt-2">
              {!rail && <p className="px-2.5 pb-1.5 text-[11px] font-semibold text-muted-foreground/80">Pinned</p>}
              <ul className="space-y-0.5">{favItems.map((i) => renderItem(i, { inFavs: true }))}</ul>
              {rail && <div className="mx-3 my-2 h-px bg-border" />}
            </div>
          )}

          {filteredGroups.map((g) => {
            const closed = !q && !rail && closedGroups.includes(g.id);
            const hasActive = g.items.some((i) => isItemActive(i, location.pathname));
            return (
              <div key={g.id} className="pt-3">
                {!rail ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    className="w-full flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-semibold text-muted-foreground/80 hover:text-foreground transition-colors"
                    aria-expanded={!closed}
                  >
                    <span className="flex items-center gap-1.5">
                      {g.label}
                      {closed && hasActive ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                    </span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", closed && "-rotate-90")} />
                  </button>
                ) : (
                  <div className="mx-3 mb-2 h-px bg-border/70 first:hidden" />
                )}
                {!closed && <ul className="space-y-0.5">{g.items.map((i) => renderItem(i))}</ul>}
              </div>
            );
          })}

          {q && filteredGroups.length === 0 && <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>}
        </nav>

        {/* Account footer */}
        <div className={cn("shrink-0 border-t border-border/70 dark:border-white/[0.06] p-3", rail && "px-2")}>
          {!rail ? (
            <div className="flex items-center gap-2.5 rounded-xl p-1.5">
              <Avatar className="h-9 w-9">
                <AvatarImage src={getSafeAvatarUrl(profile?.avatar_url, authUser?.id || authUser?.email)} />
                <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">{firstName.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[13px] font-semibold text-foreground truncate">{profile?.full_name || "Your account"}</p>
                <p className="text-[11px] text-muted-foreground truncate">{tierLabel}</p>
              </div>
              <button
                type="button"
                onClick={openAccountSwitcher}
                title="Switch account"
                aria-label="Switch account"
                className="relative h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Users className="h-4 w-4" />
                {savedAccounts.length > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {savedAccounts.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={handleSignOut} aria-label="Sign out" className="mx-auto h-10 w-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10">
                  <LogOut className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sign out</TooltipContent>
            </Tooltip>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={cn(
                "hidden md:flex mt-1 items-center gap-2 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                rail ? "mx-auto h-10 w-10 justify-center" : "w-full h-8 px-2.5"
              )}
              aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            >
              {rail ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
              {!rail && "Collapse"}
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
};

export default DashboardSidebar;
