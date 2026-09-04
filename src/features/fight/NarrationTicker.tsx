"use client";

// An append-only feed of the narrator's calls, newest first — the fight's
// running commentary.
export function NarrationTicker({
  lines,
}: {
  lines: { round: number; text: string }[];
}) {
  return (
    <div className="flex max-h-40 flex-col-reverse gap-2 overflow-y-auto" data-testid="narration-ticker">
      {lines.length === 0 ? (
        <p className="text-xs italic text-zinc-600">
          The crowd hushes. The first exchange will be narrated here.
        </p>
      ) : (
        [...lines].reverse().map((line, i) => (
          <div key={`${line.round}-${i}`} className="flex gap-2 text-sm">
            <span className="shrink-0 font-mono text-[10px] uppercase text-zinc-600">
              R{line.round}
            </span>
            <p className="leading-5 text-zinc-300">{line.text}</p>
          </div>
        ))
      )}
    </div>
  );
}
