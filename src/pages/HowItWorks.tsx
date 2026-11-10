import { useSearchParams } from "react-router-dom";
import HowItWorksContent from "@/components/HowItWorksContent";
import { parsePathId, type HowItWorksPathId } from "@/lib/howItWorks";

export default function HowItWorks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pathId = parsePathId(searchParams.get("path"));

  const changePath = (id: HowItWorksPathId) => setSearchParams({ path: id }, { replace: true });

  return (
    <main className="relative z-10 min-h-screen px-4 pt-24 pb-16 sm:pt-28">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-end gap-3 sm:gap-5">
          <div className="min-w-0 flex-1 rounded-3xl border border-border/70 bg-card/85 p-4 sm:p-6 backdrop-blur-sm">
            <p className="text-xs font-semibold text-muted-foreground">How it works</p>
            <h1 className="mt-1 text-2xl sm:text-4xl font-black tracking-tight text-foreground">
              Akwaaba! Pick what you'd like to do
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground">
              Watch a short video, or tap any step to jump straight to it.
            </p>
          </div>
          <img
            src="/assets/ama_avatar.webp"
            alt=""
            width={128}
            height={128}
            className="h-20 w-20 sm:h-32 sm:w-32 shrink-0 rounded-full border-4 border-primary/60 bg-white object-cover object-top shadow-lg"
          />
        </header>

        <HowItWorksContent pathId={pathId} onPathChange={changePath} />
      </div>
    </main>
  );
}
