import { NextRequest } from "next/server";
import { sync } from "@/server/game/engine";
import { CursorSchema, errorResponse, json, playerIdFrom } from "@/server/game/http";

// GET ?roomId=&seq= → SyncResponse. The client calls this on an interval;
// the server also advances time-driven state (the countdown) on each call.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const playerId = playerIdFrom(request);
  if (!playerId) return json({ error: "Missing or invalid x-player-id." }, 400);

  const roomId = request.nextUrl.searchParams.get("roomId");
  const seq = Number(request.nextUrl.searchParams.get("seq") ?? "0");
  const cursor = CursorSchema.safeParse(roomId ? { roomId, seq } : null);
  if (!cursor.success) return json({ error: "Malformed cursor." }, 400);

  try {
    return json(await sync(playerId, cursor.data));
  } catch (err) {
    return errorResponse(err);
  }
}
