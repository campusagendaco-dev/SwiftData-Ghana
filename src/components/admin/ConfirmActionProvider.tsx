import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatGhs, needsTypedAmount, type ConfirmOptions } from "@/lib/adminSensitive";

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const KIND_NOTE: Record<ConfirmOptions["kind"], string> = {
  money: "This moves money.",
  refund: "This refunds money to the customer.",
  payout: "This pays money out.",
  send: "This sends orders to a data provider.",
  message: "This sends messages and uses SMS/push credit.",
  access: "This changes who can use the admin pages.",
  promo: "People who already claimed this promo can claim it again.",
  account: "This suspends or restricts user accounts.",
  ops: "This changes how orders are routed to providers.",
};

function summary(opts: ConfirmOptions): string {
  const parts: string[] = [];
  if (opts.orders != null) parts.push(`${opts.orders} order${opts.orders === 1 ? "" : "s"}`);
  if (opts.amountGhs != null) parts.push(`GH₵ ${formatGhs(opts.amountGhs)}`);
  return parts.join(" · ");
}

/** Without the provider (shouldn't happen on admin pages), fall back to the browser prompt. */
const fallbackConfirm: ConfirmFn = async (opts) => {
  try {
    const text = [opts.title, opts.description, KIND_NOTE[opts.kind], summary(opts)].filter(Boolean).join("\n\n");
    return window.confirm(text);
  } catch {
    return false;
  }
};

export function ConfirmActionProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A second request while one is open cancels the first.
    resolver.current?.(false);
    setTyped("");
    setOpts(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
    setTyped("");
  };

  const mustType = opts ? needsTypedAmount(opts) : false;
  const expected = opts?.amountGhs != null ? formatGhs(opts.amountGhs) : "";
  const canConfirm = !mustType || typed.trim() === expected;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={Boolean(opts)} onOpenChange={(open) => !open && finish(false)}>
        <AlertDialogContent className="z-[200]">
          {opts && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                  {opts.title}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {opts.description && <p>{opts.description}</p>}
                    <p className="font-medium text-foreground">{KIND_NOTE[opts.kind]}</p>
                    {summary(opts) && (
                      <p className="rounded-md border border-border bg-muted px-3 py-2 font-semibold text-foreground">
                        {summary(opts)}
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              {mustType && (
                <div className="space-y-1">
                  <label htmlFor="confirm-typed-amount" className="text-xs font-medium text-muted-foreground">
                    Type {expected} to confirm
                  </label>
                  <Input
                    id="confirm-typed-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={expected}
                  />
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => finish(false)}>Cancel</AlertDialogCancel>
                <Button onClick={() => finish(true)} disabled={!canConfirm}>
                  {opts.confirmLabel || "Confirm"}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/** Ask the admin to confirm. Resolves true only if they press Confirm. */
export function useConfirmAction(): ConfirmFn {
  return useContext(ConfirmContext) ?? fallbackConfirm;
}

type Cancelled = { data: null; error: null; cancelled: true };
const CANCELLED: Cancelled = { data: null, error: null, cancelled: true };

/**
 * supabase.functions.invoke / supabase.rpc that ask the admin first. On Cancel they return
 * { cancelled: true } without calling the server — call sites must return early on it.
 */
export function useConfirmedCall() {
  const confirm = useConfirmAction();

  const invoke = useCallback(
    async (name: string, options: Record<string, unknown> | undefined, opts: ConfirmOptions) => {
      if (!(await confirm(opts))) return CANCELLED;
      const res = await supabase.functions.invoke(name, options as never);
      return { data: res.data as any, error: res.error as any, cancelled: false as const };
    },
    [confirm],
  );

  const rpc = useCallback(
    async (name: string, args: Record<string, unknown> | undefined, opts: ConfirmOptions) => {
      if (!(await confirm(opts))) return CANCELLED;
      const res = await (supabase as any).rpc(name, args);
      return { data: res.data as any, error: res.error as any, cancelled: false as const };
    },
    [confirm],
  );

  /**
   * For bulk actions only: after ONE confirm() that showed the whole batch (count + total),
   * call each item without asking again. Never use without that confirm() first.
   */
  const invokeAlreadyConfirmed = useCallback(async (name: string, options?: Record<string, unknown>) => {
    const res = await supabase.functions.invoke(name, options as never);
    return { data: res.data as any, error: res.error as any, cancelled: false as const };
  }, []);

  const rpcAlreadyConfirmed = useCallback(async (name: string, args?: Record<string, unknown>) => {
    const res = await (supabase as any).rpc(name, args);
    return { data: res.data as any, error: res.error as any, cancelled: false as const };
  }, []);

  return { invoke, rpc, confirm, invokeAlreadyConfirmed, rpcAlreadyConfirmed };
}
