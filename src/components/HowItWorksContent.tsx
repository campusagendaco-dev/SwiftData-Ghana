import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, TrendingUp, Users, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  HOW_IT_WORKS_PATHS,
  isDirectVideo,
  toVideoEmbedUrl,
  type HowItWorksPathId,
} from "@/lib/howItWorks";

const PATH_ICONS = { buy: Wifi, agent: TrendingUp, subagent: Users };

type AdminVideos = Partial<Record<HowItWorksPathId, string>>;

export default function HowItWorksContent({
  pathId,
  onPathChange,
  subAgentHref,
}: {
  pathId: HowItWorksPathId;
  onPathChange: (id: HowItWorksPathId) => void;
  /** Sub-agent signup link, known only when viewing inside an agent's store. */
  subAgentHref?: string;
}) {
  const [adminVideos, setAdminVideos] = useState<AdminVideos>({});
  const [activeStep, setActiveStep] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("public_system_settings")
          .select("tutorial_buy_video_url, tutorial_agent_video_url, tutorial_subagent_video_url")
          .eq("id", 1)
          .maybeSingle();
        if (cancelled || !data) return;
        const row = data as Record<string, string | null>;
        setAdminVideos({
          buy: row.tutorial_buy_video_url || undefined,
          agent: row.tutorial_agent_video_url || undefined,
          subagent: row.tutorial_subagent_video_url || undefined,
        });
      } catch (e) {
        console.error("Failed to load how it works videos", e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { setActiveStep(0); }, [pathId]);

  const path = HOW_IT_WORKS_PATHS.find((p) => p.id === pathId) ?? HOW_IT_WORKS_PATHS[0];
  const adminEmbed = toVideoEmbedUrl(adminVideos[path.id]);
  const videoSrc = adminEmbed || path.video;
  const usesGeneratedVideo = !adminEmbed;
  const usesVideoElement = usesGeneratedVideo || isDirectVideo(adminEmbed);
  const cta = path.id === "subagent" && subAgentHref
    ? { to: subAgentHref, label: "Become a Sub Agent" }
    : path.cta;

  const onTimeUpdate = () => {
    if (!usesGeneratedVideo || !videoRef.current) return;
    const time = videoRef.current.currentTime;
    const index = path.steps.reduce((found, step, i) => (time >= step.start ? i : found), 0);
    setActiveStep(index);
  };

  const jumpToStep = (index: number) => {
    setActiveStep(index);
    const video = videoRef.current;
    if (!usesGeneratedVideo || !video) return;
    video.currentTime = path.steps[index].start;
    void video.play().catch(() => {});
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border/70 bg-card/80 p-1.5 backdrop-blur-sm">
        {HOW_IT_WORKS_PATHS.map((item) => {
          const Icon = PATH_ICONS[item.id];
          const selected = item.id === path.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPathChange(item.id)}
              className={`min-h-11 rounded-xl px-2 py-2 text-xs sm:text-sm font-semibold inline-flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 leading-tight transition-colors ${
                selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" style={selected ? { color: item.accent } : undefined} />
              <span className="text-center">{item.tab}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div
          className={`relative w-full overflow-hidden rounded-3xl border border-border/70 bg-black shadow-lg ${
            usesGeneratedVideo ? "aspect-square" : "aspect-video"
          }`}
        >
          {usesVideoElement ? (
            <video
              key={videoSrc}
              ref={videoRef}
              src={videoSrc}
              poster={usesGeneratedVideo ? path.poster : undefined}
              onTimeUpdate={onTimeUpdate}
              controls
              playsInline
              preload="metadata"
              aria-label={`${path.title} video`}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <iframe
              key={videoSrc}
              src={videoSrc}
              title={`${path.title} video`}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
        </div>

        <div className="rounded-3xl border border-border/70 bg-card/85 p-4 sm:p-5 backdrop-blur-sm">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">{path.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{path.summary}</p>

          <ol className="mt-4 space-y-1.5">
            {path.steps.map((step, i) => {
              const active = usesGeneratedVideo && i === activeStep;
              return (
                <li key={step.title}>
                  <button
                    type="button"
                    onClick={() => jumpToStep(i)}
                    aria-current={active ? "step" : undefined}
                    className={`w-full flex items-start gap-3 rounded-2xl p-2.5 text-left transition-colors ${
                      active ? "bg-muted" : "hover:bg-muted/60"
                    }`}
                  >
                    <span
                      className="mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-black"
                      style={{ background: `${path.accent}26`, color: path.accent }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{step.title}</span>
                      <span className="block text-[13px] leading-snug text-muted-foreground">{step.detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 text-xs text-muted-foreground">{path.note}</p>

          {cta && (
            <Link
              to={cta.to}
              className="mt-3 w-full h-11 rounded-2xl bg-primary text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition"
            >
              {cta.label} <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
