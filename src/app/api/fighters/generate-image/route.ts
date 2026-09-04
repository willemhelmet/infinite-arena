import { NextRequest, NextResponse } from "next/server";
import { putPublicImage } from "@/lib/images/blobStore";

/**
 * `/api/fighters/generate-image` — the fighter-portrait forge.
 *
 * POST `{ prompt }` and a fast text-to-image model on Replicate renders the
 * fighter. The output is then re-hosted at a durable public URL (Blob, or a
 * data: URI locally without a Blob store), because the H3 feed will later
 * consume fighter images as first frames/character refs, and Replicate's
 * own delivery URLs are ephemeral.
 *
 * The call is sync-first: Replicate's `Prefer: wait` header usually resolves
 * the prediction inside the initial POST (flux-schnell typically renders in
 * 1–3s); a short poll loop catches stragglers. No webhooks, no SDK — fetch.
 *
 * Without `REPLICATE_API_KEY`, GET answers `{ enabled: false }` and POST
 * answers 503, mirroring the starter's /api/upsample capability pattern so
 * the UI can degrade to upload-only cleanly.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const REPLICATE_MODEL = "black-forest-labs/flux-schnell";
const SYNC_WAIT_SECONDS = 25;
const POLL_INTERVAL_MS = 1200;
const POLL_BUDGET_MS = 30_000;
const MAX_PROMPT_CHARS = 500;

// The graybox art direction. This wrapper is also forward-compatible framing
// for H3 first-frame use: full body, clear silhouette, readable at 1:1.
const STYLE_SUFFIX =
  ", single fighter character portrait, dynamic ready stance, arena " +
  "background, dramatic rim lighting, full body, video-game character-select " +
  "art, no text, no watermark, no logo";

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[] | null;
  error?: string | null;
  urls: { get: string };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET() {
  return NextResponse.json(
    { enabled: Boolean(process.env.REPLICATE_API_KEY) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.REPLICATE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No REPLICATE_API_KEY configured — use Upload instead." },
      { status: 503 },
    );
  }

  let prompt = "";
  try {
    const body = (await request.json()) as { prompt?: string };
    prompt = String(body.prompt ?? "")
      .trim()
      .slice(0, MAX_PROMPT_CHARS);
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }
  if (!prompt) {
    return NextResponse.json(
      { error: "Describe your fighter first." },
      { status: 400 },
    );
  }

  let prediction: ReplicatePrediction;
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: `wait=${SYNC_WAIT_SECONDS}`,
        },
        body: JSON.stringify({
          input: {
            prompt: prompt + STYLE_SUFFIX,
            aspect_ratio: "1:1",
            output_format: "png",
            num_outputs: 1,
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `The forge returned ${res.status}. ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }
    prediction = (await res.json()) as ReplicatePrediction;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Forge request failed." },
      { status: 502 },
    );
  }

  // Poll fallback for predictions the sync wait didn't resolve.
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    Date.now() < deadline
  ) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const poll = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!poll.ok) break;
      prediction = (await poll.json()) as ReplicatePrediction;
    } catch {
      break;
    }
  }

  if (prediction.status !== "succeeded") {
    const timedOut = Date.now() >= deadline;
    return NextResponse.json(
      {
        error:
          prediction.error ??
          (timedOut
            ? "The forge took too long — try again."
            : `Generation ended with status "${prediction.status}".`),
      },
      { status: timedOut ? 504 : 502 },
    );
  }

  const ephemeralUrl = prediction.output?.[0];
  if (!ephemeralUrl) {
    return NextResponse.json(
      { error: "The forge produced no image." },
      { status: 502 },
    );
  }

  try {
    const imageRes = await fetch(ephemeralUrl);
    if (!imageRes.ok) throw new Error(`output fetch ${imageRes.status}`);
    const bytes = await imageRes.arrayBuffer();
    const imageUrl = await putPublicImage(bytes, "image/png", "fighters");
    return NextResponse.json({ imageUrl });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to store the portrait.",
      },
      { status: 502 },
    );
  }
}
