/**
 * SwiftData agent console — shared UI kit.
 * Every dashboard page builds on these so spacing, type and colour stay consistent
 * in light and dark mode. Colours come from the theme tokens (bg-card, border-border,
 * text-muted-foreground, primary) so the user's accent theme still applies.
 */
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Formatting ───────────────────────────── */

export const fmtCedi = (n: number, opts: { compact?: boolean; decimals?: number } = {}) => {
  const v = Number.isFinite(n) ? n : 0;
  if (opts.compact && Math.abs(v) >= 10_000) {
    return `GH₵${new Intl.NumberFormat("en-GH", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
  }
  const d = opts.decimals ?? 2;
  return `GH₵${v.toLocaleString("en-GH", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export const fmtInt = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString("en-GH");

/* ───────────────────────────── Page header ───────────────────────────── */

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-[22px] sm:text-[28px] font-bold tracking-[-0.02em] text-foreground leading-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

/* ───────────────────────────── Surfaces ───────────────────────────── */

export const surface =
  "rounded-2xl border border-border/70 bg-card/85 text-card-foreground shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:border-white/[0.08] dark:bg-black/30 dark:shadow-none";

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  icon: Icon,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <section className={cn(surface, "overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="min-w-0 flex items-start gap-2.5">
            {Icon ? (
              <span className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Icon className="h-4 w-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <h2 className="text-[15px] font-semibold text-foreground leading-snug">{title}</h2> : null}
              {description ? <p className="text-xs text-muted-foreground mt-0.5">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", title || action ? "pt-3 sm:pt-4" : "", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ───────────────────────────── Sparkline ───────────────────────────── */

export function Sparkline({ data, className, positive = true }: { data: number[]; className?: string; positive?: boolean }) {
  if (!data.length) return null;
  const w = 100;
  const h = 32;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, h - 2 - ((v - min) / span) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const stroke = positive ? "hsl(152 60% 42%)" : "hsl(0 72% 55%)";
  const id = `spark-${positive ? "p" : "n"}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────────── Stat card ───────────────────────────── */

export function Delta({ value, suffix = "vs yesterday" }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[11px] text-muted-foreground">{suffix === "vs yesterday" ? "New today" : "—"}</span>;
  }
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-semibold tabular-nums",
          up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
        )}
      >
        <Icon className="h-3 w-3" />
        {Math.abs(value).toFixed(value !== 0 && Math.abs(value) < 10 ? 1 : 0)}%
      </span>
      <span className="hidden sm:inline truncate">{suffix}</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  deltaSuffix,
  trend,
  hint,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  delta?: number | null;
  deltaSuffix?: string;
  trend?: number[];
  hint?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const positive = delta === undefined || delta === null || delta >= 0;
  return (
    <div className={cn(surface, "p-4 flex flex-col gap-3 min-w-0", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground/70 shrink-0" /> : null}
      </div>
      {loading ? (
        <div className="h-7 w-28 rounded-md bg-muted animate-pulse" />
      ) : (
        <p className="text-[22px] sm:text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground leading-none truncate">{value}</p>
      )}
      <div className="flex items-end justify-between gap-3 min-h-[20px]">
        <div className="min-w-0">{delta !== undefined ? <Delta value={delta} suffix={deltaSuffix} /> : hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}</div>
        {trend && trend.length > 1 ? <Sparkline data={trend} positive={positive} className="h-7 w-14 sm:w-20 shrink-0" /> : null}
      </div>
    </div>
  );
}

/* ───────────────────────────── Status badge ───────────────────────────── */

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  fulfilled: { label: "Delivered", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" },
  success: { label: "Successful", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" },
  processing: { label: "Processing", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20" },
  paid: { label: "Queued", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20" },
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20" },
  fulfillment_failed: { label: "Failed", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20" },
  failed: { label: "Failed", cls: "bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20" },
  refunded: { label: "Refunded", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400 ring-violet-500/20" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground ring-border" },
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const key = String(status || "pending").toLowerCase();
  const s = STATUS_STYLES[key] || { label: key.replace(/_/g, " "), cls: "bg-muted text-muted-foreground ring-border" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset capitalize whitespace-nowrap", s.cls, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {s.label}
    </span>
  );
}

/* ───────────────────────────── Network mark ───────────────────────────── */

const NETWORK_STYLES: Record<string, { short: string; cls: string }> = {
  mtn: { short: "MTN", cls: "bg-[#ffcc00] text-[#1a1a1a]" },
  telecel: { short: "TEL", cls: "bg-[#e60000] text-white" },
  vodafone: { short: "TEL", cls: "bg-[#e60000] text-white" },
  airteltigo: { short: "AT", cls: "bg-[#0047ba] text-white" },
  at: { short: "AT", cls: "bg-[#0047ba] text-white" },
};

export function NetworkMark({ network, className }: { network?: string | null; className?: string }) {
  const k = String(network || "").toLowerCase().replace(/[^a-z]/g, "");
  const s = NETWORK_STYLES[k] || NETWORK_STYLES[k.startsWith("mtn") ? "mtn" : k.startsWith("airtel") ? "airteltigo" : k] || { short: (network || "?").slice(0, 3).toUpperCase(), cls: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-tight", s.cls, className)} aria-hidden>
      {s.short}
    </span>
  );
}

/* ───────────────────────────── Empty state ───────────────────────────── */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-2 py-10 px-4", className)}>
      <span className="h-11 w-11 rounded-xl border border-border bg-muted/60 flex items-center justify-center text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-foreground mt-1">{title}</p>
      {description ? <p className="text-xs text-muted-foreground max-w-xs">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ───────────────────────────── Buttons ───────────────────────────── */

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:brightness-105 active:scale-[0.98] transition disabled:opacity-50 disabled:pointer-events-none";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-border bg-card text-foreground text-sm font-semibold hover:bg-muted active:scale-[0.98] transition disabled:opacity-50 disabled:pointer-events-none dark:bg-white/[0.04] dark:border-white/10 dark:hover:bg-white/[0.08]";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition";
export const iconBtn =
  "inline-flex items-center justify-center h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-50";

/* ───────────────────────────── Skeleton row ───────────────────────────── */

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-1/4 rounded bg-muted/70 animate-pulse" />
          </div>
          <div className="h-3 w-14 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── Page container ───────────────────────────── */

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6", className)}>{children}</div>;
}
