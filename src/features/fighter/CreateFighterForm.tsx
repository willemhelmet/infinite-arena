"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArenaButton } from "@/components/ArenaButton";
import { ArenaPanel } from "@/components/ArenaPanel";
import { saveFighter } from "@/lib/fighters/roster";
import { useSelfPlayerId } from "@/lib/identity";
import { FighterPreviewCard } from "./FighterPreviewCard";
import { GenerateImagePanel } from "./GenerateImagePanel";
import { UploadImagePanel } from "./UploadImagePanel";

type Mode = "generate" | "upload";

export function CreateFighterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selfPlayerId = useSelfPlayerId();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<Mode>("generate");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && imageUrl !== null && !saving;

  function handleSave() {
    if (!canSave || !selfPlayerId) return;
    setSaving(true);
    saveFighter({
      name: name.trim(),
      description: description.trim(),
      imageUrl,
      createdBy: selfPlayerId,
    });
    const returnTo = searchParams.get("returnTo");
    router.push(returnTo && returnTo.startsWith("/") ? returnTo : "/");
  }

  return (
    <div className="flex flex-col gap-4">
      <ArenaPanel>
        <label className="block text-xs uppercase tracking-wide text-zinc-500">
          Fighter name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="Gorlam the Unbowed"
          data-testid="fighter-name-input"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />

        <label className="mt-4 block text-xs uppercase tracking-wide text-zinc-500">
          Describe your fighter
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          placeholder="A brine-crusted space pirate with a harpoon arm and a grudge against gravity…"
          rows={3}
          data-testid="fighter-description-input"
          className="mt-1 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
      </ArenaPanel>

      <ArenaPanel>
        <div className="flex gap-2" role="tablist" aria-label="Image source">
          <ArenaButton
            variant={mode === "generate" ? "primary" : "ghost"}
            onClick={() => setMode("generate")}
            fullWidth
          >
            Generate
          </ArenaButton>
          <ArenaButton
            variant={mode === "upload" ? "primary" : "ghost"}
            onClick={() => setMode("upload")}
            fullWidth
          >
            Upload
          </ArenaButton>
        </div>

        <div className="mt-4">
          {mode === "generate" ? (
            <GenerateImagePanel
              prompt={description}
              onGenerated={setImageUrl}
            />
          ) : (
            <UploadImagePanel onUploaded={setImageUrl} />
          )}
        </div>
      </ArenaPanel>

      {(imageUrl || name) && (
        <ArenaPanel>
          <FighterPreviewCard
            fighter={{ name, imageUrl: imageUrl ?? "", description }}
          />
        </ArenaPanel>
      )}

      <ArenaButton
        fullWidth
        disabled={!canSave}
        onClick={handleSave}
        testId="fighter-save-button"
      >
        {saving ? "Saving…" : "Save Fighter"}
      </ArenaButton>
    </div>
  );
}
