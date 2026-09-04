"use client";

import { useEffect, useState } from "react";
import { ArenaButton } from "@/components/ArenaButton";
import {
  fetchGenerateCapability,
  generateFighterImage,
} from "@/lib/fighters/api";

export function GenerateImagePanel({
  prompt,
  onGenerated,
}: {
  prompt: string;
  onGenerated: (url: string) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGenerateCapability().then((e) => {
      if (!cancelled) setEnabled(e);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate() {
    if (!prompt.trim()) {
      setError("Describe your fighter first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = await generateFighterImage(prompt.trim());
      onGenerated(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (enabled === false) {
    return (
      <p className="text-xs leading-5 text-zinc-500" data-testid="generate-disabled">
        AI generation isn't configured on this server (no{" "}
        <span className="font-mono">REPLICATE_API_KEY</span>). Switch to
        Upload to forge your fighter from your own image.
      </p>
    );
  }

  return (
    <div>
      <ArenaButton
        fullWidth
        disabled={busy || enabled === null || !prompt.trim()}
        onClick={() => void handleGenerate()}
        testId="fighter-generate-button"
      >
        {busy ? "Forging portrait…" : "Generate portrait"}
      </ArenaButton>
      {busy && (
        <p className="mt-1.5 text-[11px] text-zinc-600">
          This can take up to a minute.
        </p>
      )}
      {!prompt.trim() && !busy && (
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Describe your fighter above to unlock generation.
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
