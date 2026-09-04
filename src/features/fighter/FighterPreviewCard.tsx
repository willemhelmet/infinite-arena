"use client";

import type { Fighter } from "@/lib/game/schemas";

// Shows how a fighter will read in the arena: portrait, name, description.
// Used inside Create Fighter once an image exists.
export function FighterPreviewCard({
  fighter,
}: {
  fighter: Pick<Fighter, "name" | "imageUrl" | "description">;
}) {
  return (
    <div className="flex items-center gap-4" data-testid="fighter-preview">
      {fighter.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- graybox: data: URIs + arbitrary remote hosts
        <img
          src={fighter.imageUrl}
          alt={fighter.name || "Fighter portrait"}
          className="h-24 w-24 rounded-md border border-zinc-700 object-cover"
        />
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-zinc-700 text-[10px] uppercase text-zinc-600">
          No image
        </div>
      )}
      <div className="min-w-0">
        <h3 className="truncate text-lg font-bold text-zinc-100">
          {fighter.name || "Unnamed Fighter"}
        </h3>
        {fighter.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
            {fighter.description}
          </p>
        )}
      </div>
    </div>
  );
}
