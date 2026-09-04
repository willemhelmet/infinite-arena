// The page frame for every screen: dark arena ground, a centered max-width
// column, and an optional title bar. Graybox, but deliberately one frame —
// screens snap onto it instead of each inventing a layout.
export function ArenaShell({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        {title && (
          <h1 className="text-center text-2xl font-bold tracking-widest text-zinc-100">
            {title}
          </h1>
        )}
        {children}
      </div>
    </main>
  );
}
