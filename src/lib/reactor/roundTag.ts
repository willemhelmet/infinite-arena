// The metadata tag the fight feed writes on every enqueued round clip. The
// model never reads metadata; it echoes it back untouched on every message
// that references the clip — which is how the fight UI knows what a clip *is*
// without keeping local state a reconnect could lose.
//
// PARKED: not wired to any enqueue call in this chunk (no live H3 session
// yet). This generalizes the starter's EpisodeTag (app/lib/tag.ts) for the
// fight round loop, and will be wired in when H3Feed's "live" mode lands
// alongside the narrative coordinator.

export interface RoundTag {
  roomId: string;
  round: number; // 1-based
}

export function makeRoundTag(tag: RoundTag): string {
  return JSON.stringify(tag);
}

export function parseRoundTag(metadata: string): RoundTag | null {
  try {
    const tag = JSON.parse(metadata) as Partial<RoundTag>;
    if (typeof tag !== "object" || tag === null || !tag.roomId) return null;
    return {
      roomId: String(tag.roomId),
      round: Number(tag.round ?? 0),
    };
  } catch {
    return null;
  }
}
