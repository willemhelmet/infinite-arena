"use client";

import type { Shot } from "@/lib/game/schemas";

// The shots the coordinator wrote for a round — what the live broadcast will
// render, one fast-h3 clip per shot. Shown so the prompts can be judged by
// eye while the video feed is still parked.
export function Storyboard({
  round,
  shots,
}: {
  round: number | null;
  shots: Shot[];
}) {
  if (!round || shots.length === 0) return null;
  return (
    <details className="group" data-testid="storyboard">
      <summary className="cursor-pointer select-none text-xs uppercase tracking-wide text-zinc-500 hover:text-zinc-300">
        Storyboard · round {round} · {shots.length} shot{shots.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-2 flex flex-col gap-2">
        {shots.map((shot, i) => (
          <li
            key={i}
            className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2"
            data-testid="storyboard-shot"
          >
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase text-zinc-600">
              <span>Shot {i + 1}</span>
              <span>{shot.seconds.toFixed(1)}s</span>
            </div>
            <p className="text-xs leading-5 text-zinc-400">{shot.prompt}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
