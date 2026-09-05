"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import { useGame } from "@/lib/game/GameProvider";
import type { Fighter } from "@/lib/game/schemas";
import { CountdownOverlay } from "./CountdownOverlay";
import { PlayerSlot } from "./PlayerSlot";
import { ReadyToggle } from "./ReadyToggle";
import { RosterPicker } from "./RosterPicker";

export function LobbyScreen({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { state, send, selfPlayerId } = useGame();
  const [pickedFighter, setPickedFighter] = useState<Fighter | null>(null);
  const joinSentRef = useRef(false);

  const room = state.room;

  // Join flow: the room isn't open yet — pick a fighter first, then join.
  const isMember = room?.players.some((p) => p?.playerId === selfPlayerId);
  const needsJoin = !isMember && !joinSentRef.current;
  if (isMember) joinSentRef.current = true; // seated, however we got here

  function handleJoinWithFighter() {
    if (!pickedFighter) return;
    joinSentRef.current = true;
    send({ type: "join_room", roomId, fighter: pickedFighter });
  }

  // Navigate to the fight the instant the server fires it.
  useEffect(() => {
    if (state.phase === "fight" && room?.id === roomId) {
      router.push(`/games/${roomId}/fight`);
    }
  }, [state.phase, room?.id, roomId, router]);

  // The arena closed under us (host left, or it expired): back to the list,
  // which shows the reason.
  useEffect(() => {
    if (state.phase === "browsing_games" && state.error && joinSentRef.current) {
      router.push("/games");
    }
  }, [state.phase, state.error, router]);

  const [host, opponent] = room?.players ?? [null, null];
  const selfSlot =
    host?.playerId === selfPlayerId ? host : opponent?.playerId === selfPlayerId ? opponent : null;
  const countingDown = state.countdown !== null;

  return (
    <div className="flex flex-col gap-4">
      {state.error && (
        <ArenaPanel className="border-red-500/30">
          <p className="text-sm text-red-400">{state.error}</p>
        </ArenaPanel>
      )}

      <div className="flex gap-3" data-testid="lobby-slots">
        <PlayerSlot
          player={host}
          isSelf={host?.playerId === selfPlayerId}
          label="Challenger I"
        />
        <div className="flex items-center text-2xl font-black text-zinc-700">
          VS
        </div>
        <PlayerSlot
          player={opponent}
          isSelf={opponent?.playerId === selfPlayerId}
          label="Challenger II"
        />
      </div>

      {countingDown && <CountdownOverlay secondsRemaining={state.countdown!} />}

      {needsJoin && !isMember && (
        <ArenaPanel>
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">
            Choose your fighter
          </h2>
          <div className="mt-2">
            <RosterPicker
              selectedId={pickedFighter?.id ?? null}
              onPick={setPickedFighter}
              createReturnTo={`/games/${roomId}/lobby`}
            />
          </div>
          <div className="mt-3">
            <ArenaButton
              fullWidth
              disabled={!pickedFighter}
              onClick={handleJoinWithFighter}
              testId="join-with-fighter"
            >
              Enter the arena
            </ArenaButton>
          </div>
        </ArenaPanel>
      )}

      {isMember && !countingDown && (
        <>
          {!selfSlot?.fighter && (
            <ArenaPanel>
              <h2 className="text-xs uppercase tracking-wide text-zinc-500">
                Choose your fighter
              </h2>
              <div className="mt-2">
                <RosterPicker
                  selectedId={pickedFighter?.id ?? null}
                  onPick={() => {
                    // Fighter reassignment mid-lobby isn't part of the
                    // protocol; graybox keeps one pick per entry.
                  }}
                  createReturnTo={`/games/${roomId}/lobby`}
                />
              </div>
            </ArenaPanel>
          )}
          <ReadyToggle
            ready={selfSlot?.ready ?? false}
            disabled={!selfSlot?.fighter}
            onToggle={() =>
              send({ type: "set_ready", roomId, ready: !(selfSlot?.ready ?? false) })
            }
          />
          <p className="text-center text-[11px] text-zinc-600">
            Arena: <span className="font-mono text-zinc-500">{room?.name ?? roomId}</span>
            {" · "}when both fighters are ready, the countdown begins.
          </p>
        </>
      )}

      <ArenaButton
        variant="ghost"
        fullWidth
        onClick={() => {
          send({ type: "leave_room", roomId });
          router.push("/games");
        }}
      >
        Leave arena
      </ArenaButton>
    </div>
  );
}
