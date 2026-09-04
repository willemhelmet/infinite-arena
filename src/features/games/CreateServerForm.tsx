"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import { useGame } from "@/lib/game/GameProvider";
import type { Fighter } from "@/lib/game/schemas";
import { RosterPicker } from "@/features/lobby/RosterPicker";

export function CreateServerForm() {
  const router = useRouter();
  const { state, send, dispatchUi } = useGame();

  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [fighter, setFighter] = useState<Fighter | null>(null);
  const awaitingRoomRef = useRef(false);

  useEffect(() => {
    dispatchUi({ type: "ui_enter_create_server" });
  }, [dispatchUi]);

  // Once the server answers create_room with a room_state, route to its lobby.
  useEffect(() => {
    if (awaitingRoomRef.current && state.room?.hostPlayerId) {
      awaitingRoomRef.current = false;
      router.push(`/games/${state.room.id}/lobby`);
    }
  }, [state.room, router]);

  function handleCreate() {
    if (!fighter) return;
    awaitingRoomRef.current = true;
    send({
      type: "create_room",
      name: name.trim() || `${fighter.name}'s Arena`,
      visibility,
      hostFighterId: fighter.id,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ArenaPanel>
        <label className="block text-xs uppercase tracking-wide text-zinc-500">
          Arena name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Crucible"
          data-testid="arena-name-input"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />

        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Visibility">
          {(["public", "private"] as const).map((v) => (
            <ArenaButton
              key={v}
              variant={visibility === v ? "primary" : "ghost"}
              fullWidth
              onClick={() => setVisibility(v)}
            >
              {v === "public" ? "Public arena" : "Private arena"}
            </ArenaButton>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          {visibility === "public"
            ? "Anyone browsing the arena list can walk in."
            : "Only people you share with can find this arena."}
        </p>
      </ArenaPanel>

      <ArenaPanel>
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          Your fighter
        </h2>
        <div className="mt-2">
          <RosterPicker
            selectedId={fighter?.id ?? null}
            onPick={setFighter}
            createReturnTo="/games/new"
          />
        </div>
      </ArenaPanel>

      {state.error && (
        <ArenaPanel className="border-red-500/30">
          <p className="text-sm text-red-400">{state.error}</p>
        </ArenaPanel>
      )}

      <ArenaButton
        fullWidth
        disabled={!fighter}
        onClick={handleCreate}
        testId="create-server-button"
      >
        Open the Arena
      </ArenaButton>
    </div>
  );
}
