import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { shouldShowTour, tourSteps, TOUR_START_EVENT } from "@/lib/amaTour";

const doneKey = (userId: string) => `ama_tour_done:${userId}`;
const readDone = (userId: string) => {
  try {
    return localStorage.getItem(doneKey(userId)) === "1";
  } catch {
    return false;
  }
};
const writeDone = (userId: string) => {
  try {
    localStorage.setItem(doneKey(userId), "1");
  } catch {
    // private mode or blocked storage: the tour may show again, which is harmless
  }
};

/**
 * Ama's welcome tour: a small card with short stops, each with "Show me" to open that page.
 * Shown once to new accounts (last 7 days); any user can start it from Ama's chat.
 */
export default function AmaWelcomeTour() {
  const { user, profile, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const steps = useMemo(
    () => tourSteps({ isAgent: Boolean((profile as any)?.is_agent), isSubAgent: Boolean((profile as any)?.is_sub_agent) }),
    [profile],
  );

  useEffect(() => {
    if (!user || isAdmin) return;
    if (shouldShowTour({ userCreatedAt: (user as any).created_at, done: readDone(user.id), now: new Date() })) {
      setIndex(0);
      setOpen(true);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    const start = () => {
      if (!user) return;
      setIndex(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, [user]);

  const close = useCallback(() => {
    if (user) writeDone(user.id);
    setOpen(false);
  }, [user]);

  if (!open || !user) return null;
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Ama's welcome tour"
      className="fixed bottom-24 left-4 right-4 z-[60] mx-auto max-w-sm rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl sm:left-6 sm:right-auto"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-xl" style={{ background: "linear-gradient(135deg,#92400e,#7c3aed)" }}>
            <img src="/assets/ama_avatar.webp" alt="" className="h-full w-full scale-[1.6] object-cover object-top" />
          </div>
          <div>
            <p className="text-sm font-black">{step.title}</p>
            <p className="text-[10px] text-muted-foreground">{index + 1} of {steps.length}</p>
          </div>
        </div>
        <button type="button" onClick={close} aria-label="Skip tour" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground">{step.text}</p>
      <div className="mt-3 flex items-center gap-2">
        {step.path && (
          <button
            type="button"
            onClick={() => navigate(step.path!)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-bold hover:bg-muted"
          >
            Show me <ArrowRight className="h-3 w-3" />
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {index > 0 && (
            <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} className="h-8 rounded-lg px-3 text-xs font-bold text-muted-foreground hover:bg-muted">
              Back
            </button>
          )}
          {last ? (
            <button type="button" onClick={close} className="h-8 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">
              Finish
            </button>
          ) : (
            <button type="button" onClick={() => setIndex((i) => i + 1)} className="h-8 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
