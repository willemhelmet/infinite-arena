"use client";

import type { FightRound, Room } from "@/lib/game/schemas";
import { Storyboard } from "@/features/fight/Storyboard";

// Every exchange of the fight, blow by blow: both moves, the narrator's call,
// and where health stood when the dust cleared.
export function RoundsRecap({
  rounds,
  room,
  selfPlayerId,
}: {
  rounds: FightRound[];
  room: Room | null;
  selfPlayerId: string;
}) {
  const nameOf = (playerId: string) =>
    room?.players.find((p) => p?.playerId === playerId)?.fighter?.name ??
    (playerId === selfPlayerId ? "You" : "Opponent");

  return (
    <div className="flex flex-col gap-3" data-testid="rounds-recap">
      {rounds.map((round) => (
        <div
          key={round.round}
          className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
        >
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-zinc-600">
            <span>Round {round.round}</span>
            <span className="font-mono">
              {Object.values(round.healthAfter).join(" – ")}
            </span>
          </div>
          <ul className="flex flex-col gap-1 text-xs text-zinc-400">
            {round.prompts.map((prompt) => (
              <li key={prompt.playerId}>
                <span className="font-semibold text-zinc-300">
                  {nameOf(prompt.playerId)}:
                </span>{" "}
                {prompt.text}
              </li>
            ))}
          </ul>
          {round.narration && (
            <p className="mt-2 border-l-2 border-brand/40 pl-2 text-xs italic leading-5 text-zinc-300">
              {round.narration}
            </p>
          )}
          {round.shots && round.shots.length > 0 && (
            <div className="mt-2">
              <Storyboard round={round.round} shots={round.shots} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
