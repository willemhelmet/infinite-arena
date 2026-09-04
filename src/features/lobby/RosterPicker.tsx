"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Fighter } from "@/lib/game/schemas";
import { fetchPool } from "@/lib/fighters/pool";

// A grid of the community pool for picking a fighter. Used by Create Server
// (pick before hosting) and the lobby (pick before readying). Fighters belong
// to everybody — anyone on any device can pick any pool fighter.
export function RosterPicker({
  selectedId,
  onPick,
  createReturnTo,
}: {
  selectedId: string | null;
  onPick: (fighter: Fighter) => void;
  createReturnTo: string;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<Fighter[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchPool().then((fighters) => {
      if (!cancelled) setRoster(fighters);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-testid="roster-picker">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {roster.map((fighter) => {
          const selected = fighter.id === selectedId;
          return (
            <button
              key={fighter.id}
              type="button"
              onClick={() => onPick(fighter)}
              data-testid={`roster-fighter-${fighter.id}`}
              className={[
                "flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
                selected
                  ? "border-brand ring-1 ring-brand"
                  : "border-zinc-800 hover:border-zinc-600",
              ].join(" ")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- community pool: arbitrary remote URLs */}
              <img
                src={fighter.imageUrl}
                alt={fighter.name}
                className="aspect-square w-full object-cover"
              />
              <span className="truncate px-2 py-1.5 text-xs font-semibold text-zinc-200">
                {fighter.name}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            router.push(
              `/fighters/new?returnTo=${encodeURIComponent(createReturnTo)}`,
            )
          }
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
        >
          <span className="text-2xl">+</span>
          <span className="text-[11px] uppercase tracking-wide">
            New fighter
          </span>
        </button>
      </div>
      {roster.length === 0 && (
        <p className="mt-2 text-center text-xs text-zinc-600">
          No fighters yet — forge the pool's first one.
        </p>
      )}
    </div>
  );
}
