import { NextRequest } from "next/server";
import { z } from "zod";
import { FighterSchema, FightRoundSchema, RoundPromptSchema } from "@/lib/game/schemas";
import { isBroadcaster } from "@/server/broadcaster";
import { resolveRound } from "@/server/game/coordinator";
import { errorResponse, json } from "@/server/game/http";

// The narrative coordinator as a service, for the broadcaster: judge one
// round of a chat fight. Same engine the web fight uses (coordinator.ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Side = z.object({
  playerId: z.string(),
  fighter: FighterSchema,
  health: z.number().min(0).max(100),
  prompt: RoundPromptSchema,
});
const Body = z.object({
  arenaName: z.string().max(80),
  round: z.number().int().positive(),
  fighters: z.tuple([Side, Side]),
  history: z.array(FightRoundSchema).default([]),
  setting: z.string().nullable().default(null),
});

export async function POST(request: NextRequest) {
  if (!isBroadcaster(request)) return json({ error: "Broadcaster only." }, 403);
  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await request.json());
  } catch {
    return json({ error: "Malformed resolve request." }, 400);
  }
  try {
    return json(await resolveRound(input));
  } catch (err) {
    return errorResponse(err);
  }
}
