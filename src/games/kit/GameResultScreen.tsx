export type ResultOutcome = "win" | "lose" | "draw";

const MESSAGES: Record<ResultOutcome, { title: string; detail: string }> = {
  win: { title: "You won!", detail: "Well played. Ayekoo!" },
  lose: { title: "So close!", detail: "Have another go. You've got this." },
  draw: { title: "It's a draw", detail: "An even match. Time for a decider?" },
};

export default function GameResultScreen({
  outcome,
  points,
  onRematch,
  onExit,
}: {
  outcome: ResultOutcome;
  points?: number;
  onRematch?: () => void;
  onExit: () => void;
}) {
  const message = MESSAGES[outcome];

  return (
    <section className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 text-center shadow-xl">
      <img
        src="/assets/ama_avatar.webp"
        alt=""
        width={96}
        height={96}
        className="mx-auto h-24 w-24 rounded-full border-4 border-primary/60 bg-white object-cover object-top"
      />
      <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground">{message.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{message.detail}</p>
      {points !== undefined && points > 0 && (
        <p className="mt-3 text-base font-bold text-primary">+{points} Arena Points</p>
      )}
      <div className="mt-4 space-y-2">
        {onRematch && (
          <button
            type="button"
            onClick={onRematch}
            className="h-11 w-full rounded-2xl bg-primary text-sm font-bold text-primary-foreground active:scale-[0.98] transition"
          >
            Play again
          </button>
        )}
        <button
          type="button"
          onClick={onExit}
          className="h-11 w-full rounded-2xl border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors"
        >
          Back to games
        </button>
      </div>
    </section>
  );
}
