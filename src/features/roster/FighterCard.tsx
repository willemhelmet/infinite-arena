"use client";

import { ArenaButton } from "@/components/ArenaButton";
import type { Fighter } from "@/lib/game/schemas";

export function FighterCard({
  fighter,
  createdAt,
  isMine,
  inRoster,
  onUse,
  onRemove,
}: {
  fighter: Fighter;
  createdAt: number;
  isMine: boolean;
  inRoster: boolean;
  onUse: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      data-testid="gallery-fighter"
      data-fighter-id={fighter.id}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- user content */}
      <img
        src={fighter.imageUrl}
        alt={fighter.name}
        className="h-24 w-24 shrink-0 rounded-md border border-zinc-700 object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-bold text-zinc-100">{fighter.name}</h3>
          {isMine && (
            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand">
              Yours
            </span>
          )}
        </div>
        {fighter.description && (
          <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-zinc-400">
            {fighter.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="font-mono text-[10px] text-zinc-600">
            {new Date(createdAt).toLocaleDateString()}
          </span>
          <div className="flex gap-1">
            {isMine && (
              <ArenaButton variant="danger" onClick={onRemove} testId="gallery-remove">
                Retire
              </ArenaButton>
            )}
            <ArenaButton
              variant={inRoster ? "ghost" : "primary"}
              disabled={inRoster}
              onClick={onUse}
              testId="gallery-use"
            >
              {inRoster ? "In your roster" : "Use this fighter"}
            </ArenaButton>
          </div>
        </div>
      </div>
    </article>
  );
}
