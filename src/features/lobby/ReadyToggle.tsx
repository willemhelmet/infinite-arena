"use client";

import { ArenaButton } from "@/components/ArenaButton";

export function ReadyToggle({
  ready,
  disabled,
  onToggle,
}: {
  ready: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <ArenaButton
      fullWidth
      variant={ready ? "ghost" : "primary"}
      disabled={disabled}
      onClick={onToggle}
      testId="ready-toggle"
    >
      {ready ? "Stand down" : "READY"}
    </ArenaButton>
  );
}
