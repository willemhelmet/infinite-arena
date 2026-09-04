"use client";

// The graybox stand-in for the arena broadcast: a dark panel that announces
// the round and pulses while the narrator resolves both attacks. Where the
// real WebRTC video mounts, this aspect ratio and frame are what it inherits.
export function MockH3Feed({
  round,
  resolving,
}: {
  round: number;
  resolving: boolean;
}) {
  return (
    <div
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950"
      data-testid="mock-h3-feed"
    >
      <div
        className={[
          "absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_60%)] transition-opacity duration-700",
          resolving ? "animate-pulse opacity-100" : "opacity-40",
        ].join(" ")}
      />
      <div className="relative flex flex-col items-center gap-1">
        <span className="text-[10px] uppercase tracking-[0.4em] text-zinc-600">
          Live from the arena
        </span>
        <span className="text-5xl font-black tracking-widest text-zinc-300">
          ROUND {round}
        </span>
        <span className="text-xs text-zinc-600">
          {resolving ? "The narrator weighs both moves…" : "Awaiting your attack"}
        </span>
      </div>
    </div>
  );
}
