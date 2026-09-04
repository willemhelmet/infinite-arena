"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArenaButton } from "@/components/ArenaButton";
import { HowToPlayModal } from "./HowToPlayModal";

export function EntryMenu() {
  const router = useRouter();
  const [howToOpen, setHowToOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <h1
          className="text-5xl font-black tracking-[0.2em] text-zinc-100"
          data-testid="game-title"
        >
          INFINITE
          <br />
          ARENA
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          Your fighter. Your words. One AI-narrated duel.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <ArenaButton fullWidth onClick={() => router.push("/watch")}>
          Watch the Arena
        </ArenaButton>
        <ArenaButton fullWidth onClick={() => router.push("/fighters/new")}>
          Create Fighter
        </ArenaButton>
        <ArenaButton fullWidth onClick={() => router.push("/fighters")}>
          View Fighters
        </ArenaButton>
        <ArenaButton fullWidth onClick={() => router.push("/games")}>
          Join Game
        </ArenaButton>
        <ArenaButton fullWidth onClick={() => router.push("/games/new")}>
          Create Server
        </ArenaButton>
        <ArenaButton
          fullWidth
          variant="ghost"
          onClick={() => setHowToOpen(true)}
        >
          ⓘ How to Play
        </ArenaButton>
      </div>

      <HowToPlayModal open={howToOpen} onClose={() => setHowToOpen(false)} />
    </div>
  );
}
