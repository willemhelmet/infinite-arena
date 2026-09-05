import { NextRequest } from "next/server";
import { z } from "zod";
import { FighterSchema } from "@/lib/game/schemas";
import { isBroadcaster } from "@/server/broadcaster";
import { programShots } from "@/server/game/coordinator";
import { errorResponse, json } from "@/server/game/http";

// Storyboards for the parts of the show that aren't a round: a fighter's
// bio (idle programming), the card announcing the next fight, the verdict.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bio"), fighter: FighterSchema, setting: z.string().nullable().default(null) }),
  z.object({
    kind: z.literal("card"),
    a: FighterSchema,
    b: FighterSchema,
    arenaName: z.string().max(80),
    setting: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal("verdict"),
    winner: FighterSchema.nullable(),
    loser: FighterSchema.nullable(),
    narration: z.string().max(600),
    setting: z.string().nullable().default(null),
  }),
]);

export async function POST(request: NextRequest) {
  if (!isBroadcaster(request)) return json({ error: "Broadcaster only." }, 403);
  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await request.json());
  } catch {
    return json({ error: "Malformed program request." }, 400);
  }
  try {
    return json(await programShots(input));
  } catch (err) {
    return errorResponse(err);
  }
}
