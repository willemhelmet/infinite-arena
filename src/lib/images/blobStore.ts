import { put } from "@vercel/blob";

// Hosts fighter images at a publicly reachable URL.
//
// Production path: @vercel/blob put() with public access + a random suffix —
// durable, fetchable over https, and exactly what the H3 feed needs later
// when it consumes fighter images as first frames / character refs.
//
// Local-dev path: with no BLOB_READ_WRITE_TOKEN, falls back to a data: URI.
// That keeps Create Fighter fully usable offline (preview + roster) but is
// NOT a real public URL — H3 can't fetch a data: URI. We warn loudly so the
// fallback is never mistaken for the real thing.

let warnedFallback = false;

export async function putPublicImage(
  bytes: ArrayBuffer,
  contentType: string,
  pathPrefix: string,
): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        "[blobStore] BLOB_READ_WRITE_TOKEN unset — fighter images are being " +
          "stored as data: URIs. These are NOT publicly reachable and won't " +
          "work as H3 first frames. Attach a Vercel Blob store for production.",
      );
    }
    const base64 = Buffer.from(bytes).toString("base64");
    return `data:${contentType};base64,${base64}`;
  }

  const ext = contentType.split("/")[1] ?? "png";
  const { url } = await put(
    `${pathPrefix}/${crypto.randomUUID()}.${ext}`,
    bytes,
    {
      access: "public",
      addRandomSuffix: true,
      contentType,
    },
  );
  return url;
}
