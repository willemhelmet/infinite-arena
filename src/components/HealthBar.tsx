// A graybox meter: a labeled bar that fills 0-100. The fight screen places one
// per combatant, tone can swap to communicate a losing side at a glance.
export function HealthBar({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "low" | "enemy";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill =
    tone === "low"
      ? "bg-red-500"
      : tone === "enemy"
        ? "bg-rose-500"
        : "bg-emerald-500";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-wide text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-500">{clamped}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-sm bg-zinc-800">
        <div
          className={`h-full transition-all duration-500 ${fill}`}
          style={{ width: `${clamped}%` }}
          data-testid="healthbar-fill"
        />
      </div>
    </div>
  );
}
