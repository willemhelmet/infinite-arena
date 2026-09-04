"use client";

import type { Fighter } from "@/lib/game/schemas";
import { readLocalPool, writeLocalPool } from "./poolStore";

// The client-facing community pool. Fetches through /api/pool; when the
// server reports no blob store, it falls back to a localStorage pool so the
// solo device keeps a working roster.

interface PoolResponse {
  enabled: boolean;
  fighters: unknown;
}

export async function fetchPool(): Promise<Fighter[]> {
  try {
    const res = await fetch("/api/pool", { cache: "no-store" });
    if (!res.ok) return readLocalPool();
    const body = (await res.json()) as PoolResponse;
    if (!body.enabled) return readLocalPool();
    const fighters = Array.isArray(body.fighters)
      ? (body.fighters as Fighter[])
      : [];
    if (fighters.length > 0) {
      // Keep a warm offline copy for unconfigured local runs.
      writeLocalPool(fighters);
    }
    return fighters;
  } catch {
    return readLocalPool();
  }
}

export async function savePoolFighter(
  fighter: Pick<Fighter, "name" | "imageUrl" | "description" | "createdBy">,
): Promise<Fighter> {
  const res = await fetch("/api/pool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fighter),
  });
  const body = (await res.json()) as Fighter & { error?: string };

  if (res.ok) {
    // Warm the offline cache whenever the server hands us a fighter back.
    const existing = readLocalPool();
    if (!existing.some((f) => f.id === body.id)) {
      writeLocalPool([...existing, body]);
    }
    return body;
  }

  // 503 from the future "no blob store" guard, or an upstream 502: keep the
  // fighter locally so a solo run still progresses, and say so.
  if (res.status === 503 || res.status === 502) {
    const local: Fighter = {
      ...fighter,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    writeLocalPool([...readLocalPool(), local]);
    return local;
  }
  throw new Error(body.error ?? `Save failed (${res.status}).`);
}

export async function deleteFighterFromPool(id: string): Promise<void> {
  // Graybox keeps fighters until a moderation shape exists; deletion is a
  // local cleanup so the roster grid stays tidy, never a pool mutation.
  writeLocalPool(readLocalPool().filter((f) => f.id !== id));
}
