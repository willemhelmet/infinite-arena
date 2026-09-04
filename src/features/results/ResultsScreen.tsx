"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import { useGame } from "@/lib/game/GameProvider";
import { RoundsRecap } from "./RoundsRecap";
import { WinnerCard } from "./WinnerCard";

export function ResultsScreen({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { state, send, selfPlayerId } = useGame();
  const result = state.result;

  // Rematch drops us back into the same room's lobby once the server resets it.
  useEffect(() => {
    if (state.phase === "lobby" && state.room?.id === roomId) {
      router.push(`/games/${roomId}/lobby`);
    }
  }, [state.phase, state.room?.id, roomId, router]);

  if (!result) {
    return (
      <ArenaPanel>
        <p className="text-center text-sm text-zinc-500">
          No verdict on record for this arena yet.
        </p>
        <div className="mt-4">
          <ArenaButton fullWidth variant="ghost" onClick={() => router.push("/")}>
            Return to menu
          </ArenaButton>
        </div>
      </ArenaPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <WinnerCard result={result} room={state.room} selfPlayerId={selfPlayerId} />

      <ArenaPanel>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-zinc-500">
          How the fight unfolded
        </h2>
        <RoundsRecap
          rounds={result.rounds}
          room={state.room}
          selfPlayerId={selfPlayerId}
        />
      </ArenaPanel>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ArenaButton
          fullWidth
          onClick={() => send({ type: "request_rematch", roomId })}
          testId="rematch-button"
        >
          Rematch
        </ArenaButton>
        <ArenaButton
          fullWidth
          variant="ghost"
          onClick={() => {
            send({ type: "leave_room", roomId });
            router.push("/");
          }}
          testId="return-to-menu-button"
        >
          Return to menu
        </ArenaButton>
      </div>
    </div>
  );
}
