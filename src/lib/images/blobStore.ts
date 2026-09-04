import { put } from "@vercel/blob";

// Hosts fighter images at a publicly reachable URL.
//
// Auth precedence (matching the blob SDK's runtime behavior):
//   1. Vercel OIDC — VERCEL_OIDC_TOKEN + BLOB_STORE_ID (your protected store)
//   2. Classic read/write token — BLOB_READ_WRITE_TOKEN
//   3. Local fallback — data: URI, with a loud warning (H3 canNOT use it)

const OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
const STORE_ID = process.env.BLOB_STORE_ID;
const RW_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function hasBlobWrite(): boolean {
  return Boolean((OIDC_TOKEN && STORE_ID) || RW_TOKEN);
}

let warnedFallback = false;

export async function putPublicImage(
  bytes: ArrayBuffer,
  contentType: string,
  pathPrefix: string,
): Promise<string> {
  if (!hasBlobWrite()) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn(
        "[blobStore] no OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) or " +
          "BLOB_READ_WRITE_TOKEN — fighter images are being stored as data: " +
          "URIs. These are NOT publicly reachable and won't work as H3 first " +
          "frames. Attach/connect a Blob store for production.",
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
      // When OIDC is available, pass the pair — the SDK prefers it over the
      // static token and rotates automatically.
      ...(OIDC_TOKEN && STORE_ID
        ? { oidcToken: OIDC_TOKEN, storeId: STORE_ID }
        : { token: RW_TOKEN }),
    },
  );
  return url;
}
