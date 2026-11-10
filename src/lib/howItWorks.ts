export type HowItWorksPathId = "buy" | "agent" | "subagent";

/** Timing of the generated videos. Must match scripts/how-it-works-video/scene.html. */
export const VIDEO_INTRO_SECONDS = 3;
export const VIDEO_STEP_SECONDS = 7;

export interface HowItWorksStep {
  title: string;
  detail: string;
  /** Second of the generated video where this step begins. */
  start: number;
}

export interface HowItWorksPath {
  id: HowItWorksPathId;
  tab: string;
  title: string;
  summary: string;
  accent: string;
  video: string;
  poster: string;
  steps: HowItWorksStep[];
  note: string;
  cta: { to: string; label: string } | null;
}

const withStarts = (steps: Omit<HowItWorksStep, "start">[]): HowItWorksStep[] =>
  steps.map((step, i) => ({ ...step, start: VIDEO_INTRO_SECONDS + VIDEO_STEP_SECONDS * i }));

const media = (id: HowItWorksPathId) => ({
  video: `/videos/how-it-works-${id}-v2.mp4`,
  poster: `/videos/how-it-works-${id}.webp`,
});

export const HOW_IT_WORKS_PATHS: HowItWorksPath[] = [
  {
    id: "buy",
    tab: "Buy Data",
    title: "Buy a data bundle",
    summary: "MTN, Telecel or AirtelTigo data in four easy steps. No account needed.",
    accent: "#f59e0b",
    ...media("buy"),
    steps: withStarts([
      { title: "Pick your bundle", detail: "Choose your network, then tap the bundle you want." },
      { title: "Enter the number", detail: "Type the Ghana number that should get the data. It can be yours or someone else's." },
      { title: "Pay securely", detail: "Pay with Mobile Money or card through Paystack." },
      { title: "Get your data", detail: "Your bundle arrives in 10 to 60 minutes. Track your order any time." },
    ]),
    note: "Delivery in 10 to 60 minutes. Secured by Paystack.",
    cta: { to: "/buy-data", label: "Buy Data Now" },
  },
  {
    id: "agent",
    tab: "Become an Agent",
    title: "Become a data agent",
    summary: "Get wholesale prices and your own store, and keep the profit on every sale.",
    accent: "#22c55e",
    ...media("agent"),
    steps: withStarts([
      { title: "Sign in", detail: "Create your SwiftData account or sign in to the one you have." },
      { title: "Request approval", detail: "Open the Agent Program page and tap to request approval." },
      { title: "Pay the activation fee", detail: "Pay through Paystack with Mobile Money or card. The current fee is shown on the page." },
      { title: "Get approved and set up", detail: "Your account is reviewed and approved after payment. Then set up your store." },
      { title: "Share and earn", detail: "Set your prices, share your store link and earn on every successful order." },
    ]),
    note: "The activation fee is shown on the Agent Program page before you pay.",
    cta: { to: "/agent-program", label: "Become an Agent" },
  },
  {
    id: "subagent",
    tab: "Become a Sub Agent",
    title: "Become a sub agent",
    summary: "Join under an agent you know and run your own store.",
    accent: "#a855f7",
    ...media("subagent"),
    steps: withStarts([
      { title: "Open your agent's store", detail: "Use their store link, find Become a Sub-Agent and tap Get Started." },
      { title: "Fill in your details", detail: "Enter your name, phone number and store details." },
      { title: "Pay the activation fee", detail: "The fee is set by your agent. Pay through Paystack with Mobile Money or card." },
      { title: "Start selling", detail: "Your store is ready. Share your link and earn on every successful order." },
    ]),
    note: "Ask the agent you know for their store link to get started.",
    cta: null,
  },
];

export const parsePathId = (value: string | null | undefined): HowItWorksPathId =>
  HOW_IT_WORKS_PATHS.find((path) => path.id === value)?.id ?? "buy";

const YOUTUBE_ID =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** Turns a video link saved in Admin Settings into something the player can load. */
export const toVideoEmbedUrl = (url?: string | null): string => {
  if (!url) return "";
  const id = url.match(YOUTUBE_ID)?.[1];
  return id ? `https://www.youtube.com/embed/${id}?rel=0` : url;
};

export const isDirectVideo = (url: string) => /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
