"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import {
  fetchAllFighters,
  registerFighter,
  unregisterFighter,
  type RegisteredFighter,
} from "@/lib/fighters/api";
import { deleteFighter, importFighter, loadRoster } from "@/lib/fighters/roster";
import { useSelfPlayerId } from "@/lib/identity";
import type { Fighter } from "@/lib/game/schemas";
import { FighterCard } from "./FighterCard";

// Every fighter anyone has forged, from the shared registry. Your own are
// marked; any fighter can be pulled into this browser's roster so a champion
// forged on a laptop can enter the arena from a phone.
export function FighterGallery() {
  const router = useRouter();
  const selfPlayerId = useSelfPlayerId();
  const [all, setAll] = useState<RegisteredFighter[] | null>(null);
  const [rosterIds, setRosterIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "mine">("all");

  const refresh = useCallback(async () => {
    try {
      const fighters = await fetchAllFighters();
      setAll(fighters);
      setError(null);
      return fighters;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load fighters.");
      return null;
    }
  }, []);

  // Load the catalog, then back-fill: fighters forged in this browser before
  // the registry existed get published so they show up everywhere.
  useEffect(() => {
    if (!selfPlayerId) return;
    let cancelled = false;
    (async () => {
      const local = loadRoster();
      setRosterIds(new Set(local.map((f) => f.id)));
      const fighters = await refresh();
      if (cancelled || !fighters) return;
      const known = new Set(fighters.map((r) => r.fighter.id));
      const missing = local.filter(
        (f) => !known.has(f.id) && f.createdBy === selfPlayerId,
      );
      if (missing.length === 0) return;
      await Promise.allSettled(missing.map((f) => registerFighter(f)));
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [selfPlayerId, refresh]);

  function handleUse(fighter: Fighter) {
    importFighter(fighter);
    setRosterIds((prev) => new Set(prev).add(fighter.id));
  }

  async function handleRemove(fighter: Fighter) {
    if (!window.confirm(`Retire ${fighter.name} from the arena for good?`)) return;
    try {
      await unregisterFighter(fighter.id);
      deleteFighter(fighter.id);
      setRosterIds((prev) => {
        const next = new Set(prev);
        next.delete(fighter.id);
        return next;
      });
      setAll((prev) => prev?.filter((r) => r.fighter.id !== fighter.id) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove fighter.");
    }
  }

  const shown = useMemo(() => {
    if (!all) return [];
    return filter === "mine" ? all.filter((r) => r.fighter.createdBy === selfPlayerId) : all;
  }, [all, filter, selfPlayerId]);
  const mineCount = all?.filter((r) => r.fighter.createdBy === selfPlayerId).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <ArenaPanel className="border-red-500/30">
          <p className="text-sm text-red-400">{error}</p>
        </ArenaPanel>
      )}

      <ArenaPanel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {all === null
              ? "Loading fighters…"
              : `${all.length} fighter${all.length === 1 ? "" : "s"} in the arena`}
          </h2>
          <div className="flex gap-1" role="tablist" aria-label="Filter">
            <ArenaButton
              variant={filter === "all" ? "primary" : "ghost"}
              onClick={() => setFilter("all")}
              testId="gallery-filter-all"
            >
              All
            </ArenaButton>
            <ArenaButton
              variant={filter === "mine" ? "primary" : "ghost"}
              onClick={() => setFilter("mine")}
              testId="gallery-filter-mine"
            >
              Mine ({mineCount})
            </ArenaButton>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          data-testid="fighter-gallery"
        >
          {all !== null && shown.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-zinc-600">
              {filter === "mine"
                ? "You haven't forged a fighter yet."
                : "No fighters yet. Forge the first one."}
            </p>
          )}
          {shown.map(({ fighter, createdAt }) => (
            <FighterCard
              key={fighter.id}
              fighter={fighter}
              createdAt={createdAt}
              isMine={fighter.createdBy === selfPlayerId}
              inRoster={rosterIds.has(fighter.id)}
              onUse={() => handleUse(fighter)}
              onRemove={() => handleRemove(fighter)}
            />
          ))}
        </div>
      </ArenaPanel>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ArenaButton fullWidth onClick={() => router.push("/fighters/new?returnTo=%2Ffighters")}>
          Forge a new fighter
        </ArenaButton>
        <ArenaButton fullWidth variant="ghost" onClick={() => router.push("/")}>
          Back to menu
        </ArenaButton>
      </div>
    </div>
  );
}
