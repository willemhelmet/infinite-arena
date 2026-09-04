"use client";

import type { PlayerSlot as PlayerSlotType } from "@/lib/game/schemas";

// One seat in the arena. Shows the fighter (or a waiting placeholder), whose
// seat it is, and their ready state.
export function PlayerSlot({
  player,
  isSelf,
  label,
}: {
  player: PlayerSlotType | null;
  isSelf: boolean;
  label: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
      data-testid="player-slot"
    >
      <span className="text-[10px] uppercase tracking-widest text-zinc-600">
        {label}
        {isSelf && " (you)"}
      </span>
      {player?.fighter ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- user content */}
          <img
            src={player.fighter.imageUrl}
            alt={player.fighter.name}
            className="h-28 w-28 rounded-lg border border-zinc-700 object-cover"
          />
          <span className="text-center text-sm font-bold text-zinc-100">
            {player.fighter.name}
          </span>
        </>
      ) : (
        <>
          <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-zinc-700">
            <span className="text-3xl">?</span>
          </div>
          <span className="text-xs text-zinc-600">Awaiting fighter…</span>
        </>
      )}
      <span
        className={[
          "rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest",
          player?.ready
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-zinc-800 text-zinc-500",
        ].join(" ")}
        data-testid="ready-pill"
      >
        {player?.ready ? "Ready" : "Not ready"}
      </span>
    </div>
  );
}
