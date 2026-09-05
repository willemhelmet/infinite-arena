import { NextRequest } from "next/server";
import { ShowStateSchema } from "@/lib/show/schema";
import { isBroadcaster } from "@/server/broadcaster";
import { errorResponse, json } from "@/server/game/http";
import { readShow, writeShow } from "@/server/show/store";

// What's on the channel.
//   GET → ShowState (offline when the broadcaster hasn't published lately)
//   PUT ShowState with x-broadcaster-secret → publish

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await readShow());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  if (!isBroadcaster(request)) return json({ error: "Broadcaster only." }, 403);
  try {
    const parsed = ShowStateSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "Malformed show state." }, 400);
    await writeShow(parsed.data);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
