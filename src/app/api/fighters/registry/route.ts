import { NextRequest } from "next/server";
import { z } from "zod";
import { FighterSchema } from "@/lib/game/schemas";
import { errorResponse, json, playerIdFrom } from "@/server/game/http";
import {
  getFighter,
  listFighters,
  registerFighter,
  unregisterFighter,
} from "@/server/fighters/registry";

// The shared fighter catalog.
//   GET            → { fighters: RegisteredFighter[] } newest first
//   POST  Fighter  → registers (or re-registers) the caller's fighter
//   DELETE ?id=    → removes one of the caller's fighters
// The caller is the x-player-id header; a fighter's createdBy must match it
// to be written or removed. No auth beyond that — graybox.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A data: URI portrait means no Blob store was attached when it was forged.
// Those are fine locally but would bloat Redis; refuse the very large ones.
const MAX_INLINE_IMAGE_CHARS = 400_000;

export async function GET() {
  try {
    return json({ fighters: await listFighters() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const playerId = playerIdFrom(request);
  if (!playerId) return json({ error: "Missing or invalid x-player-id." }, 400);

  let fighter: z.infer<typeof FighterSchema>;
  try {
    fighter = FighterSchema.parse(await request.json());
  } catch {
    return json({ error: "Malformed fighter." }, 400);
  }
  if (fighter.createdBy !== playerId) {
    return json({ error: "You can only register your own fighters." }, 403);
  }
  if (fighter.imageUrl.startsWith("data:") && fighter.imageUrl.length > MAX_INLINE_IMAGE_CHARS) {
    return json(
      { error: "Portrait is too large to share without image storage attached." },
      413,
    );
  }

  try {
    return json(await registerFighter(fighter), 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  const playerId = playerIdFrom(request);
  if (!playerId) return json({ error: "Missing or invalid x-player-id." }, 400);
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return json({ error: "Missing id." }, 400);

  try {
    const existing = await getFighter(id);
    if (!existing) return json({ ok: true });
    if (existing.fighter.createdBy !== playerId) {
      return json({ error: "You can only remove your own fighters." }, 403);
    }
    await unregisterFighter(id);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
