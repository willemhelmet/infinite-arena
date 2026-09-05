import { getKV } from "@/server/game/kv";
import { OFFLINE_SHOW, ShowStateSchema, type ShowState } from "@/lib/show/schema";

// What the channel is showing. Written only by the broadcaster; read by
// everyone. A broadcaster that stops publishing goes "offline" after
// STALE_AFTER_MS so the watch page never shows a fight that isn't happening.

const KEY = "arena:show";
const STALE_AFTER_MS = 30_000;

export async function readShow(): Promise<ShowState> {
  const raw = await getKV().get(KEY);
  if (!raw) return OFFLINE_SHOW;
  try {
    const parsed = ShowStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return OFFLINE_SHOW;
    if (Date.now() - parsed.data.updatedAt > STALE_AFTER_MS) {
      return { ...OFFLINE_SHOW, queue: parsed.data.queue };
    }
    return parsed.data;
  } catch {
    return OFFLINE_SHOW;
  }
}

export async function writeShow(state: ShowState): Promise<void> {
  await getKV().set(KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
}
