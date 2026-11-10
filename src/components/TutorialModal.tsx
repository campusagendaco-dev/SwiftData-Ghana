import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, TrendingUp, Users, Wifi, X } from "lucide-react";
import HowItWorksContent from "@/components/HowItWorksContent";
import { HOW_IT_WORKS_PATHS, type HowItWorksPathId } from "@/lib/howItWorks";

const STORAGE_KEY = "swiftdata-tutorial-seen";
const HOW_IT_WORKS_ROUTE = "/how-it-works";

const PATH_ICONS = { buy: Wifi, agent: TrendingUp, subagent: Users };
const WELCOME_LABELS: Record<HowItWorksPathId, string> = {
  buy: "Buy a data bundle",
  agent: "Become a data agent",
  subagent: "Become a sub agent",
};

const hasSeenWelcome = () => {
  try { return Boolean(localStorage.getItem(STORAGE_KEY)); } catch { return true; }
};

const markWelcomeSeen = () => {
  try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* Ignore storage errors */ }
};

export default function TutorialModal({ inStore = false }: { inStore?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [storePath, setStorePath] = useState<HowItWorksPathId | null>(null);

  const onHowItWorksPage = location.pathname === HOW_IT_WORKS_ROUTE;
  const slug = location.pathname.match(/^\/store\/([^/]+)/)?.[1];

  useEffect(() => {
    if (!hasSeenWelcome() && !onHowItWorksPage) setWelcomeOpen(true);
  }, [onHowItWorksPage]);

  const open = (id: HowItWorksPathId = "buy") => {
    if (inStore) setStorePath(id);
    else navigate(`${HOW_IT_WORKS_ROUTE}?path=${id}`);
  };

  useEffect(() => {
    const handler = () => {
      if (inStore) setStorePath("buy");
      else navigate(`${HOW_IT_WORKS_ROUTE}?path=buy`);
    };
    window.addEventListener("open-tutorial", handler);
    return () => window.removeEventListener("open-tutorial", handler);
  }, [inStore, navigate]);

  const closeWelcome = () => {
    markWelcomeSeen();
    setWelcomeOpen(false);
  };

  if (storePath) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) setStorePath(null); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How it works"
          className="relative w-full max-w-4xl max-h-[92dvh] overflow-y-auto rounded-3xl border border-border bg-background p-4 sm:p-5"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">How it works</h2>
            <button
              type="button"
              onClick={() => setStorePath(null)}
              aria-label="Close"
              className="h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <HowItWorksContent
            pathId={storePath}
            onPathChange={setStorePath}
            subAgentHref={slug ? `/store/${slug}/sub-agent` : undefined}
          />
        </div>
      </div>
    );
  }

  if (welcomeOpen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
        onClick={(e) => { if (e.target === e.currentTarget) closeWelcome(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to SwiftData"
          className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-4 shadow-xl"
        >
          <button
            type="button"
            onClick={closeWelcome}
            aria-label="Close"
            className="absolute right-2.5 top-2.5 h-10 w-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3 pr-10">
            <img src="/assets/ama_avatar.webp" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-full border-2 border-primary/60 bg-white object-cover object-top" />
            <div className="min-w-0">
              <h2 className="text-base font-black text-foreground">Akwaaba to SwiftData!</h2>
              <p className="text-xs text-muted-foreground">What would you like to do?</p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {HOW_IT_WORKS_PATHS.map(({ id, accent }) => {
              const Icon = PATH_ICONS[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { closeWelcome(); open(id); }}
                  className="w-full min-h-12 rounded-2xl border border-border/70 px-3 py-2 flex items-center gap-3 text-left hover:bg-muted/60 transition-colors"
                >
                  <span className="h-8 w-8 shrink-0 rounded-xl flex items-center justify-center" style={{ background: `${accent}26`, color: accent }}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 text-sm font-semibold text-foreground">{WELCOME_LABELS[id]}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={closeWelcome}
            className="mt-2 w-full min-h-10 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (onHowItWorksPage) return null;

  return (
    <button
      type="button"
      onClick={() => open()}
      className="fixed bottom-24 right-4 z-40 w-10 h-10 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-all hover:scale-110 shadow-lg bg-card/90 backdrop-blur-xl"
      title="How it works"
      aria-label="How it works"
    >
      <span className="text-base font-black">?</span>
    </button>
  );
}
