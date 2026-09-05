import { getKV } from "@/server/game/kv";
import { ChatMessageSchema, type ChatMessage } from "@/lib/show/schema";

// The arena's one chat thread: an append-only list in Redis with a global
// sequence number so pollers ask for "everything after seq". Only the last
// CHAT_KEEP messages are retained — this is a live room, not an archive.

const LIST = "arena:chat";
const SEQ = "arena:chat:seq";
const CHAT_KEEP = 500;

export async function appendMessage(
  message: Omit<ChatMessage, "seq" | "id" | "ts">,
): Promise<ChatMessage> {
  const kv = getKV();
  const seq = await kv.incr(SEQ);
  const full: ChatMessage = {
    ...message,
    seq,
    id: crypto.randomUUID().slice(0, 12),
    ts: Date.now(),
  };
  await kv.rpush(LIST, [JSON.stringify(full)], 7 * 24 * 3600);
  await kv.ltrimLast(LIST, CHAT_KEEP);
  return full;
}

/** Messages with seq > since, oldest first, capped to the retained window. */
export async function readMessages(since: number, limit = 200): Promise<ChatMessage[]> {
  const raw = await getKV().lrange(LIST, -Math.min(limit, CHAT_KEEP), -1);
  const out: ChatMessage[] = [];
  for (const r of raw) {
    try {
      const parsed = ChatMessageSchema.safeParse(JSON.parse(r));
      if (parsed.success && parsed.data.seq > since) out.push(parsed.data);
    } catch {
      // skip a corrupt entry
    }
  }
  return out;
}

export async function latestSeq(): Promise<number> {
  return Number((await getKV().get(SEQ)) ?? "0");
}
