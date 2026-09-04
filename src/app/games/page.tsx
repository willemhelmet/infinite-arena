"use client";

import { useEffect } from "react";
import { ArenaShell } from "@/components/ArenaShell";
import { BackButton } from "@/components/BackButton";
import { GameList } from "@/features/games/GameList";
import { useGame } from "@/lib/game/GameProvider";

export default function Page() {
  const { dispatchUi } = useGame();
  useEffect(() => {
    dispatchUi({ type: "ui_enter_games" });
  }, [dispatchUi]);

  return (
    <ArenaShell title="JOIN A GAME">
      <BackButton />
      <GameList />
    </ArenaShell>
  );
}
