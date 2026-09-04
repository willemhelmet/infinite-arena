"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArenaPanel } from "@/components/ArenaPanel";
import { HealthBar } from "@/components/HealthBar";
import { useGame } from "@/lib/game/GameProvider";
import { MAX_ROUNDS } from "@/lib/game/rules";
import { H3Feed } from "./H3Feed";
import { NarrationTicker } from "./NarrationTicker";
import { PromptInput } from "./PromptInput";
import { RoundIndicator } from "./RoundIndicator";

const H3_LIVE = process.env.NEXT_PUBLIC_H3_LIVE === "1";

export function FightScreen({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { state, send, selfPlayerId } = useGame();

  const room = state.room;
  const [host, opponent] = room?.players ?? [null, null];
  const selfSlot = host?.playerId === selfPlayerId ? host : opponent;
  const foeSlot = host?.playerId === selfPlayerId ? opponent : host;

  const currentRound = state.currentRound;
  const selfSubmitted = Boolean(
    currentRound?.prompts.some((p) => p.playerId === selfPlayerId),
  );
  const opponentSubmitted = Boolean(
    currentRound?.prompts.some((p) => p.playerId !== selfPlayerId) ?? false,
  );
  const resolving = selfSubmitted && !state.narrations.some((n) => n.round === currentRound?.round);

  // The fight is over — head to the verdict.
  useEffect(() => {
    if (state.phase === "results" && room?.id === roomId) {
      router.push(`/games/${roomId}/results`);
    }
  }, [state.phase, room?.id, roomId, router]);

  // The opponent walked out mid-fight and the arena closed.
  useEffect(() => {
    if (state.phase === "browsing_games" && state.error) router.push("/games");
  }, [state.phase, state.error, router]);

  return (
    <div className="flex flex-col gap-4">
      <H3Feed
        mode={H3_LIVE ? "live" : "mock"}
        roomId={roomId}
        round={currentRound?.round ?? 1}
        resolving={resolving}
      />

      <ArenaPanel>
        <RoundIndicator
          round={currentRound?.round ?? 1}
          maxRounds={MAX_ROUNDS}
          selfSubmitted={selfSubmitted}
          opponentSubmitted={opponentSubmitted}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <HealthBar
            label={selfSlot?.fighter?.name ?? "You"}
            value={selfSlot?.health ?? 100}
            tone={(selfSlot?.health ?? 100) <= 30 ? "low" : "normal"}
          />
          <HealthBar
            label={foeSlot?.fighter?.name ?? "Opponent"}
            value={foeSlot?.health ?? 100}
            tone="enemy"
          />
        </div>
      </ArenaPanel>

      <ArenaPanel>
        <h2 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
          The narrator calls it
        </h2>
        <NarrationTicker lines={state.narrations} />
      </ArenaPanel>

      <ArenaPanel>
        <PromptInput
          disabled={selfSubmitted || !currentRound}
          onSubmit={(text) =>
            send({
              type: "submit_prompt",
              roomId,
              round: currentRound?.round ?? 1,
              prompt: text,
            })
          }
        />
      </ArenaPanel>
    </div>
  );
}
