"use client";

import type { Fighter } from "@/lib/game/schemas";
import { deleteFighterFromPool } from "@/lib/fighters/pool";
import { fetchPool } from "@/lib/fighters/pool";

// Roster reading is the community pool — a shared, cross-device list of
// fighters. This module is a thin compatibility shim over the pool so older
// imports keep compiling while the pool concept settles in.

export async function loadRoster(): Promise<Fighter[]> {
  return fetchPool();
}
