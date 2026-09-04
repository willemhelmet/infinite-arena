import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  addPoolFighter,
  hasBlobStore,
  listPoolFighters,
} from "@/lib/fighters/poolStore";

// The community fighter pool API — shared across every device.
//   GET  → { enabled, fighters: Fighter[] }  (server mirrors blob presence so the
//          client can fall back to local pool data when there's no store yet)
//   POST → Fighter (a full pool fighter the caller just composed)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreatePoolFighterSchema = z.object({
  name: z.string().min(1).max(40),
  imageUrl: z.string().url(),
  description: z.string().max(500).default(""),
  createdBy: z.string().default(""),
});

export async function GET() {
  try {
    const fighters = await listPoolFighters();
    return NextResponse.json(
      { enabled: hasBlobStore(), fighters },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pool read failed." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!hasBlobStore()) {
    return NextResponse.json(
      { error: "No blob store attached — fighters can only be kept locally." },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }
  const parsed = CreatePoolFighterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Fighter failed validation: name and image URL are required." },
      { status: 400 },
    );
  }
  try {
    const fighter = await addPoolFighter(parsed.data);
    return NextResponse.json(fighter, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pool write failed." },
      { status: 502 },
    );
  }
}
