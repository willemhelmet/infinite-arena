"use client";

import type { FightResult, Room } from "@/lib/game/schemas";

export function WinnerCard({
  result,
  room,
  selfPlayerId,
}: {
  result: FightResult;
  room: Room | null;
  selfPlayerId: string;
}) {
  const winnerFighter = room?.players.find(
    (p) => p?.playerId === result.winnerPlayerId,
  )?.fighter;
  const youWon = result.winnerPlayerId === selfPlayerId;
  const draw = result.winnerPlayerId === null;

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-brand/30 bg-zinc-950/60 p-6 text-center"
      data-testid="winner-card"
    >
      <span className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">
        {draw ? "The arena cannot decide" : youWon ? "Victory" : "Defeat"}
      </span>
      {draw ? (
        <span className="text-2xl font-black uppercase tracking-widest text-zinc-200">
          A draw
        </span>
      ) : (
        <>
          {winnerFighter && (
            // eslint-disable-next-line @next/next/no-img-element -- user content
            <img
              src={winnerFighter.imageUrl}
              alt={winnerFighter.name}
              className="h-28 w-28 rounded-lg border border-zinc-700 object-cover"
            />
          )}
          <span className="text-2xl font-black uppercase tracking-widest text-zinc-100">
            {winnerFighter?.name ?? "Unknown Champion"}
          </span>
        </>
      )}
      <span className="text-xs text-zinc-500">
        after {result.rounds.length} round{result.rounds.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}
