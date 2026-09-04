"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import { useGame } from "@/lib/game/GameProvider";
import { GameListItem } from "./GameListItem";

export function GameList() {
  const router = useRouter();
  const { state, send } = useGame();

  useEffect(() => {
    send({ type: "list_rooms" });
  }, [send]);

  function handleJoin(roomId: string) {
    router.push(`/games/${roomId}/lobby`);
  }

  return (
    <div className="flex flex-col gap-4">
      {state.error && (
        <ArenaPanel className="border-red-500/30">
          <p className="text-sm text-red-400">{state.error}</p>
        </ArenaPanel>
      )}

      <ArenaPanel>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Active arenas
          </h2>
          <ArenaButton
            variant="ghost"
            onClick={() => send({ type: "list_rooms" })}
          >
            Refresh
          </ArenaButton>
        </div>

        <div className="mt-3 flex flex-col gap-2" data-testid="game-list">
          {state.roomList.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-600">
              No arenas found. Host one yourself!
            </p>
          ) : (
            state.roomList.map((room) => (
              <GameListItem key={room.id} room={room} onJoin={handleJoin} />
            ))
          )}
        </div>
      </ArenaPanel>

      <ArenaButton variant="ghost" fullWidth onClick={() => router.push("/games/new")}>
        Or host your own arena
      </ArenaButton>
    </div>
  );
}
