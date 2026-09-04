"use client";

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
