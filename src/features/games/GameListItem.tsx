"use client";

import { ArenaButton } from "@/components/ArenaButton";
import type { RoomSummary } from "@/lib/game/schemas";

const STATUS_LABEL: Record<RoomSummary["status"], string> = {
  open: "Waiting for a challenger",
  in_lobby: "In lobby",
  in_fight: "Fight underway",
  full: "Full",
};

export function GameListItem({
  room,
  onJoin,
}: {
  room: RoomSummary;
  onJoin: (roomId: string) => void;
}) {
  const joinable = room.status === "open" || room.status === "in_lobby";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold text-zinc-100">
            {room.name}
          </h3>
          {room.visibility === "private" && (
            <span className="text-[10px] uppercase tracking-wide text-zinc-600">
              Private
            </span>
          )}
        </div>
        <p className="truncate text-xs text-zinc-500">
          Host: <span className="text-zinc-400">{room.hostFighterName}</span>
          {" · "}
          {STATUS_LABEL[room.status]}
        </p>
      </div>
      <ArenaButton
        variant={joinable ? "primary" : "ghost"}
        disabled={!joinable}
        onClick={() => onJoin(room.id)}
        className="shrink-0"
      >
        Join
      </ArenaButton>
    </div>
  );
}
