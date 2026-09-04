import { NextRequest } from "next/server";
import { z } from "zod";
import { CHAT_TEXT_MAX, HANDLE_RE } from "@/lib/show/schema";
import { isBroadcaster } from "@/server/broadcaster";
import { appendMessage, latestSeq, readMessages } from "@/server/chat/store";
import { errorResponse, json, playerIdFrom } from "@/server/game/http";

// The arena chat.
//   GET  ?since=N            → { seq, messages } everything after N (poll)
//   POST { text, handle }    → a viewer message (x-player-id required)
//   POST { text, handle, kind } with x-broadcaster-secret → system/narrator
// Commands (!fight, !attack, ...) are ordinary messages here; the
// broadcaster reads the thread and acts on them, then answers in kind.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UserBody = z.object({
  text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
  handle: z.string().regex(HANDLE_RE),
});
const BroadcasterBody = UserBody.extend({
  handle: z.string().min(1).max(32),
  kind: z.enum(["system", "narrator"]).default("system"),
  text: z.string().trim().min(1).max(600),
});

export async function GET(request: NextRequest) {
  const since = Number(request.nextUrl.searchParams.get("since") ?? "0");
  if (!Number.isFinite(since) || since < 0) return json({ error: "Bad since." }, 400);
  try {
    const [messages, seq] = await Promise.all([readMessages(since), latestSeq()]);
    return json({ seq, messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed message." }, 400);
  }

  try {
    if (isBroadcaster(request)) {
      const parsed = BroadcasterBody.safeParse(body);
      if (!parsed.success) return json({ error: "Malformed message." }, 400);
      const { text, handle, kind } = parsed.data;
      return json(await appendMessage({ kind, handle, playerId: null, text }), 201);
    }
    const playerId = playerIdFrom(request);
    if (!playerId) return json({ error: "Missing or invalid x-player-id." }, 400);
    const parsed = UserBody.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Pick a handle (2-20 letters, digits, _) and say something." }, 400);
    }
    const { text, handle } = parsed.data;
    return json(await appendMessage({ kind: "user", handle, playerId, text }), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
