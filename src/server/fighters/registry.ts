import { FighterSchema, type Fighter } from "@/lib/game/schemas";
import { getKV } from "@/server/game/kv";

// The shared fighter registry: every fighter anyone has forged, from any
// device. Portraits already live at public URLs (Blob); this is the index of
// name + description + image that makes them browsable and reusable across
// browsers. Records never expire. Each browser still keeps its own roster in
// localStorage for picking — the registry is the catalog, the roster is the
// hand.

export interface RegisteredFighter {
  fighter: Fighter;
  createdAt: number;
}

const key = (id: string) => `arena:fighter:${id}`;
const ALL = "arena:fighters";

export async function listFighters(): Promise<RegisteredFighter[]> {
  const kv = getKV();
  const ids = await kv.smembers(ALL);
  const raws = await Promise.all(ids.map((id) => kv.get(key(id))));
  const out: RegisteredFighter[] = [];
  for (const [i, raw] of raws.entries()) {
    if (!raw) {
      void kv.srem(ALL, ids[i]);
      continue;
    }
    try {
      const rec = JSON.parse(raw) as RegisteredFighter;
      if (FighterSchema.safeParse(rec.fighter).success) out.push(rec);
    } catch {
      // skip a corrupt record
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getFighter(id: string): Promise<RegisteredFighter | null> {
  const raw = await getKV().get(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegisteredFighter;
  } catch {
    return null;
  }
}

/** Upsert. Keeps the original createdAt on re-registration. */
export async function registerFighter(fighter: Fighter): Promise<RegisteredFighter> {
  const kv = getKV();
  const existing = await getFighter(fighter.id);
  const record: RegisteredFighter = {
    fighter,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await kv.set(key(fighter.id), JSON.stringify(record));
  await kv.sadd(ALL, fighter.id);
  return record;
}

export async function unregisterFighter(id: string): Promise<void> {
  const kv = getKV();
  await kv.srem(ALL, id);
  await kv.del(key(id));
}
