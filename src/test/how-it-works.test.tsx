import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

import {
  HOW_IT_WORKS_PATHS,
  VIDEO_INTRO_SECONDS,
  VIDEO_STEP_SECONDS,
  parsePathId,
  toVideoEmbedUrl,
} from "@/lib/howItWorks";
import HowItWorksContent from "@/components/HowItWorksContent";

const renderContent = (pathId: "buy" | "agent" | "subagent" = "buy", subAgentHref?: string) =>
  render(
    <MemoryRouter>
      <HowItWorksContent pathId={pathId} onPathChange={() => {}} subAgentHref={subAgentHref} />
    </MemoryRouter>,
  );

describe("how it works content", () => {
  it("has the three paths with their own video", () => {
    expect(HOW_IT_WORKS_PATHS.map((p) => p.id)).toEqual(["buy", "agent", "subagent"]);
    for (const path of HOW_IT_WORKS_PATHS) {
      expect(path.video).toBe(`/videos/how-it-works-${path.id}-v2.mp4`);
      expect(path.poster).toBe(`/videos/how-it-works-${path.id}.webp`);
    }
  });

  it("starts each step at its place in the video", () => {
    for (const path of HOW_IT_WORKS_PATHS) {
      path.steps.forEach((step, i) => {
        expect(step.start).toBe(VIDEO_INTRO_SECONDS + VIDEO_STEP_SECONDS * i);
      });
    }
  });

  it("states the real delivery time", () => {
    const buy = JSON.stringify(HOW_IT_WORKS_PATHS[0]);
    expect(buy).toContain("10 to 60 minutes");
    expect(buy.toLowerCase()).not.toContain("within seconds");
    expect(buy.toLowerCase()).not.toContain("instantly");
  });

  it("includes the agent activation and approval steps", () => {
    const agent = JSON.stringify(HOW_IT_WORKS_PATHS[1]).toLowerCase();
    expect(agent).toContain("activation fee");
    expect(agent).toContain("approved");
  });

  it("falls back to buy for an unknown path", () => {
    expect(parsePathId("agent")).toBe("agent");
    expect(parsePathId("nonsense")).toBe("buy");
    expect(parsePathId(null)).toBe("buy");
  });

  it("converts admin video links", () => {
    expect(toVideoEmbedUrl("https://www.youtube.com/watch?v=325sYiZ80Uo")).toBe("https://www.youtube.com/embed/325sYiZ80Uo?rel=0");
    expect(toVideoEmbedUrl("https://youtu.be/325sYiZ80Uo")).toBe("https://www.youtube.com/embed/325sYiZ80Uo?rel=0");
    expect(toVideoEmbedUrl("https://x.test/a.mp4")).toBe("https://x.test/a.mp4");
    expect(toVideoEmbedUrl("")).toBe("");
  });
});

describe("HowItWorksContent", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: {} });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  });

  it("uses the generated video when no admin link is set", async () => {
    const { container } = renderContent();
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    expect(container.querySelector("video")).toHaveAttribute("src", "/videos/how-it-works-buy-v2.mp4");
  });

  it("jumps the video when a step is tapped", async () => {
    const { container } = renderContent();
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Enter the number/ }));
    expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(10);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("lets an admin link replace the generated video", async () => {
    maybeSingle.mockResolvedValue({ data: { tutorial_buy_video_url: "https://www.youtube.com/watch?v=325sYiZ80Uo" } });
    const { container } = renderContent();
    await waitFor(() => expect(container.querySelector("iframe")).toBeInTheDocument());
    expect(container.querySelector("video")).toBeNull();
  });

  it("offers the sub-agent button only when a store is known", async () => {
    renderContent("subagent");
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Become a Sub Agent/ })).toBeNull();
  });

  it("links to the store's sub-agent signup when in a store", async () => {
    renderContent("subagent", "/store/kofi/sub-agent");
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /Become a Sub Agent/ })).toHaveAttribute("href", "/store/kofi/sub-agent");
  });
});
