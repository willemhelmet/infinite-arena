import { NextRequest } from "next/server";
import { z } from "zod";
import { ClientEventSchema } from "@/lib/game/protocol";
import { handleClientEvent, sync } from "@/server/game/engine";
import { CursorSchema, errorResponse, json, playerIdFrom } from "@/server/game/http";

// POST { event, cursor } → SyncResponse. Applies one ClientEvent for the
// calling player, then returns everything the client is missing (including
// the events this very action produced), so the UI updates without waiting
// for the next poll.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A second attack can trigger the LLM coordinator inside this request.
export const maxDuration = 60;

const BodySchema = z.object({ event: ClientEventSchema, cursor: CursorSchema });

export async function POST(request: NextRequest) {
  const playerId = playerIdFrom(request);
  if (!playerId) return json({ error: "Missing or invalid x-player-id." }, 400);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return json({ error: "Malformed event." }, 400);
  }

  try {
    const reply = await handleClientEvent(playerId, body.event);
    const state = await sync(playerId, body.cursor);
    return json({ ...state, events: [...reply, ...state.events] });
  } catch (err) {
    return errorResponse(err);
  }
}
