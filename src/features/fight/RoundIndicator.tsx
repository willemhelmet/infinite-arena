"use client";

// Shows the round count and both combatants' submission state at a glance.
export function RoundIndicator({
  round,
  maxRounds,
  selfSubmitted,
  opponentSubmitted,
}: {
  round: number;
  maxRounds: number;
  selfSubmitted: boolean;
  opponentSubmitted: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between text-xs text-zinc-500"
      data-testid="round-indicator"
    >
      <span className="font-mono uppercase tracking-widest">
        Round {round} / {maxRounds}
      </span>
      <div className="flex gap-3">
        <span className={selfSubmitted ? "text-emerald-400" : "text-zinc-600"}>
          You {selfSubmitted ? "✓" : "…"}
        </span>
        <span className={opponentSubmitted ? "text-rose-400" : "text-zinc-600"}>
          Foe {opponentSubmitted ? "✓" : "…"}
        </span>
      </div>
    </div>
  );
}
