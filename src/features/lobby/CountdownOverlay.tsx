"use client";

import { ArenaPanel } from "@/components/ArenaPanel";

// The 3-2-1 beat before the fight starts. Rendered as an in-flow panel;
// big enough to be unmistakable, themed like a ring announcer.
export function CountdownOverlay({ secondsRemaining }: { secondsRemaining: number }) {
  return (
    <ArenaPanel className="border-brand/40" data-testid="countdown-overlay">
      <div className="flex flex-col items-center py-6">
        <span className="text-xs uppercase tracking-[0.3em] text-zinc-500">
          The arena gates close in
        </span>
        <span
          className="mt-2 text-7xl font-black text-zinc-100"
          data-testid="countdown-number"
        >
          {secondsRemaining}
        </span>
      </div>
    </ArenaPanel>
  );
}
