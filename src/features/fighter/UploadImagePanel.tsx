"use client";

import { useRef, useState } from "react";
import { ArenaButton } from "@/components/ArenaButton";
import { uploadFighterImage } from "@/lib/fighters/api";

const MAX_MB = 4;

export function UploadImagePanel({
  onUploaded,
}: {
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("That's not an image file.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Image must be smaller than ${MAX_MB} MB.`);
      return;
    }
    setBusy(true);
    try {
      const url = await uploadFighterImage(file);
      onUploaded(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="fighter-file-input"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <ArenaButton
        variant="ghost"
        fullWidth
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading…" : "Choose an image"}
      </ArenaButton>
      <p className="mt-1.5 text-[11px] text-zinc-600">
        PNG, JPEG, WebP, or GIF — up to {MAX_MB} MB.
      </p>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
