"use client";

import { FighterSchema, type Fighter } from "@/lib/game/schemas";
import { z } from "zod";

// The local fighter roster. A player's saved fighters are per-browser, not
// per-room — in the real system this will be a REST/oRPC resource, not a WS
// message — so it lives in localStorage behind a thin Zod-validated API, and
// deliberately stays OUT of the GameClient protocol.

const STORAGE_KEY = "infinite-arena:roster";

const RosterSchema = z.array(FighterSchema);

function read(): Fighter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = RosterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(fighters: Fighter[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fighters));
}

export function loadRoster(): Fighter[] {
  return read();
}

export function getFighter(id: string): Fighter | null {
  return read().find((f) => f.id === id) ?? null;
}

export function saveFighter(
  fighter: Omit<Fighter, "id" | "createdBy"> & { createdBy: string },
): Fighter {
  const full: Fighter = {
    ...fighter,
    id: crypto.randomUUID(),
  };
  write([...read(), full]);
  return full;
}

/** Adds a fighter from the shared registry to this browser's roster, keeping
 *  its id so the same fighter isn't duplicated across devices. */
export function importFighter(fighter: Fighter): void {
  const current = read();
  if (current.some((f) => f.id === fighter.id)) return;
  write([...current, fighter]);
}

export function deleteFighter(id: string) {
  write(read().filter((f) => f.id !== id));
}
