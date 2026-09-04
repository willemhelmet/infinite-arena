// The starter's one card treatment, extracted so screens compose from it
// instead of copy-pasting`rounded-xl border border-zinc-800 bg-zinc-900/40`.
export function ArenaPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-xl border border-zinc-800 bg-zinc-900/40 p-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
