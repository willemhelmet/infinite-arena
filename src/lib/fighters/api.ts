"use client";

import type { Fighter } from "@/lib/game/schemas";
import { getSelfPlayerId } from "@/lib/identity";

// Thin fetch wrappers over the fighter-image API routes. The routes return
// { imageUrl } on success or { error } on failure; these wrappers normalize
// both into a thrown Error so callers have one shape.

export async function generateFighterImage(prompt: string): Promise<string> {
  const res = await fetch("/api/fighters/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = (await res.json()) as { imageUrl?: string; error?: string };
  if (!res.ok || !body.imageUrl) {
    throw new Error(body.error ?? `Generation failed (${res.status}).`);
  }
  return body.imageUrl;
}

export async function uploadFighterImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/fighters/upload-image", {
    method: "POST",
    body: form,
  });
  const body = (await res.json()) as { imageUrl?: string; error?: string };
  if (!res.ok || !body.imageUrl) {
    throw new Error(body.error ?? `Upload failed (${res.status}).`);
  }
  return body.imageUrl;
}

export async function fetchGenerateCapability(): Promise<boolean> {
  try {
    const res = await fetch("/api/fighters/generate-image", {
      cache: "no-store",
    });
    const body = (await res.json()) as { enabled?: boolean };
    return Boolean(body.enabled);
  } catch {
    return false;
  }
}

// --- The shared fighter registry ---------------------------------------------

export interface RegisteredFighter {
  fighter: Fighter;
  createdAt: number;
}

export async function fetchAllFighters(): Promise<RegisteredFighter[]> {
  const res = await fetch("/api/fighters/registry", { cache: "no-store" });
  const body = (await res.json()) as { fighters?: RegisteredFighter[]; error?: string };
  if (!res.ok || !body.fighters) {
    throw new Error(body.error ?? `Could not load fighters (${res.status}).`);
  }
  return body.fighters;
}

/** Publishes one of this browser's fighters to the shared registry. */
export async function registerFighter(fighter: Fighter): Promise<void> {
  const res = await fetch("/api/fighters/registry", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-player-id": getSelfPlayerId() },
    body: JSON.stringify(fighter),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not share fighter (${res.status}).`);
  }
}

export async function unregisterFighter(id: string): Promise<void> {
  const res = await fetch(`/api/fighters/registry?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-player-id": getSelfPlayerId() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not remove fighter (${res.status}).`);
  }
}
