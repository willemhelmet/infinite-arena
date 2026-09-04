"use client";

import { useRouter } from "next/navigation";

// A quiet "go back one screen" affordance for sub-screens (fighters, games).
// Uses history back rather than a hardcoded href so it also behaves from
// cross-screen links (e.g. the lobby's "create fighter" returnTo path).
export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      data-testid="back-button"
      className="self-start text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
    >
      ← {label}
    </button>
  );
}
