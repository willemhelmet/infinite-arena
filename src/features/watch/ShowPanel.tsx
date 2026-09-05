"use client";

import { ArenaPanel } from "@/components/ArenaPanel";
import { HealthBar } from "@/components/HealthBar";
import type { ShowState } from "@/lib/show/schema";

const PROGRAM_LABEL: Record<ShowState["program"], string> = {
  offline: "Off air",
  idle: "Between fights",
  card: "Next fight",
  fight: "Fight underway",
  verdict: "The verdict",
};

export function ShowPanel({ show }: { show: ShowState }) {
  const fight = show.fight;
  return (
    <ArenaPanel>
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
        <span data-testid="show-program">{PROGRAM_LABEL[show.program]}</span>
        {show.queued && (
          <span className="font-mono text-[10px]">
            ready {show.queued.ready} · building {show.queued.building}
          </span>
        )}
      </div>

      {fight ? (
        <div className="mt-3" data-testid="show-fight">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-600">
            <span>
              Round {fight.round}/{fight.maxRounds}
            </span>
            <span>
              {fight.roundState === "open"
                ? "attacks open"
                : fight.roundState === "judging"
                  ? "the narrator weighs both moves"
                  : "on air"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {[fight.a, fight.b].map((side, i) => (
              <div key={side.playerId}>
                <HealthBar
                  label={`${side.fighter.name} (${side.handle})`}
                  value={side.health}
                  tone={i === 0 ? (side.health <= 30 ? "low" : "normal") : "enemy"}
                />
                <p className="mt-1 text-[10px] text-zinc-600">
                  {fight.roundState === "open" ? (side.attacked ? "move locked in" : "waiting for !attack") : ""}
                </p>
              </div>
            ))}
          </div>
          {fight.narration && (
            <p className="mt-3 border-l-2 border-brand/40 pl-2 text-xs italic leading-5 text-zinc-300">
              {fight.narration}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-500" data-testid="show-idle">
          {show.program === "offline"
            ? "Nobody is running the arena right now."
            : show.nowPlaying
              ? `Now: ${show.nowPlaying}`
              : "Fighter bios are on air. Type !fight <fighter> to line up."}
        </p>
      )}

      <div className="mt-3 border-t border-zinc-800 pt-2 text-xs text-zinc-500" data-testid="show-queue">
        <span className="uppercase tracking-wide">Up next</span>
        {show.queue.length === 0 ? (
          <span className="ml-2 text-zinc-600">nobody yet</span>
        ) : (
          <ol className="mt-1 flex flex-wrap gap-2">
            {show.queue.map((e, i) => (
              <li key={`${e.handle}-${i}`} className="rounded-full border border-zinc-800 px-2 py-0.5">
                {e.fighterName} <span className="text-zinc-600">({e.handle})</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </ArenaPanel>
  );
}
