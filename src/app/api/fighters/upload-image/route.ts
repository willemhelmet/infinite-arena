import { NextRequest, NextResponse } from "next/server";
import { putPublicImage } from "@/lib/images/blobStore";

// Uploads a local image as a fighter portrait and re-hosts it at a public
// URL. Mirrors the generate route's contract so the UI treats both paths
// the same: POST multipart (field "file") → { imageUrl } | { error }.

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: NextRequest) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json(
      { error: "Malformed form data — expected multipart with a 'file' field." },
      { status: 400 },
    );
  }

  if (!file) {
    return NextResponse.json(
      { error: "No file provided under the 'file' field." },
      { status: 400 },
    );
  }
  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}". Use PNG, JPEG, WebP, or GIF.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image is larger than 4 MB." },
      { status: 400 },
    );
  }

  try {
    const bytes = await file.arrayBuffer();
    const imageUrl = await putPublicImage(bytes, file.type, "fighters");
    return NextResponse.json({ imageUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 502 },
    );
  }
}
