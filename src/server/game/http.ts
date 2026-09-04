import { NextResponse } from "next/server";
import { z } from "zod";
import { RoomBusyError } from "./store";

// Shared plumbing for the /api/game/* routes.

const PLAYER_ID = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

export const CursorSchema = z
  .object({ roomId: z.string().min(1).max(32), seq: z.number().int().nonnegative() })
  .nullable();

export function playerIdFrom(request: Request): string | null {
  const parsed = PLAYER_ID.safeParse(request.headers.get("x-player-id"));
  return parsed.success ? parsed.data : null;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function errorResponse(err: unknown) {
  if (err instanceof RoomBusyError) return json({ error: err.message }, 503);
  const message = err instanceof Error ? err.message : "Arena server error.";
  console.error("[api/game]", err);
  return json({ error: message }, 500);
}
