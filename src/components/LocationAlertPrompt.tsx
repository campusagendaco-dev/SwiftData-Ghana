import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  LOCATION_CONSENT_VERSION,
  callLocationCheck,
  getGrantedPosition,
  hasCheckedToday,
  markCheckedToday,
  requestPosition,
} from "@/lib/locationAlerts";

type StatusResponse = { eligible: boolean; status: "unset" | "granted" | "declined"; sms_opt_out: boolean };

const POPUP_DELAY_MS = 20_000;

export function LocationAlertPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const answeredRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (hasCheckedToday()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const status = await callLocationCheck<StatusResponse>({ action: "status" });
      if (cancelled || !status) return; // error: leave the day unmarked, retry next open

      if (!status.eligible || status.status === "declined" || status.sms_opt_out) {
        markCheckedToday();
        return;
      }

      if (status.status === "granted") {
        const position = await getGrantedPosition();
        if (cancelled) return;
        const result = await callLocationCheck<{ needs_consent: boolean }>({ action: "check", ...(position ?? {}) });
        if (!cancelled && result) markCheckedToday();
        return;
      }

      // status unset: ask once, after a short wait, and only if nothing else is open
      timer = setTimeout(() => {
        if (cancelled) return;
        if (document.querySelector('[role="dialog"]')) return;
        answeredRef.current = false;
        setOpen(true);
        markCheckedToday();
      }, POPUP_DELAY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  const handleYes = async () => {
    answeredRef.current = true;
    setOpen(false);
    void callLocationCheck({ action: "set_consent", choice: "yes", version: LOCATION_CONSENT_VERSION });
    const position = await requestPosition();
    if (position) await callLocationCheck({ action: "check", ...position });
  };

  const handleNo = () => {
    answeredRef.current = true;
    setOpen(false);
    void callLocationCheck({ action: "set_consent", choice: "no", version: LOCATION_CONSENT_VERSION });
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    setOpen(false);
    // X, Escape and outside click count as dismissed; yes/no already recorded their answer
    if (!answeredRef.current) {
      answeredRef.current = true;
      void callLocationCheck({ action: "set_consent", choice: "dismissed", version: LOCATION_CONSENT_VERSION });
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        {/* Light overlay so the Adinkra background stays visible around the popup */}
        <DialogOverlay className="bg-black/10" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-card/95 p-6 text-center text-foreground shadow-lg backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <img src="/assets/ama_avatar.webp" alt="" className="mx-auto h-20 w-20 rounded-full object-cover" />
          <DialogTitle className="text-center text-lg leading-snug text-foreground">
            Want a text when SwiftData reaches a new town you visit?
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground">
            We'll only text you when you arrive somewhere new. You can turn this off anytime in Account Settings.
          </DialogDescription>
          <div className="flex flex-col gap-2">
            <Button onClick={handleYes}>Yes, text me</Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={handleNo}>
              No thanks
            </Button>
          </div>
          <DialogClose className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
