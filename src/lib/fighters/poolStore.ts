import { put, list } from "@vercel/blob";
import { FighterSchema, type Fighter } from "@/lib/game/schemas";

// The community fighter pool — server-side persistence via @vercel/blob.
//
// Two blob shapes under one prefix:
//   pool/manifest.json            — the ordered index of fighter ids (oldest→newest)
//   pool/fighters/<id>.json       — one fighter's full data
//
// Reads assemble: list all fighter docs, order them to the manifest. The
// manifest only carries ORDER, so a fighter that exists but isn't indexed yet
// still shows up (appended). Fighter docs are the authoritative record.
//
// Fallback: without a blob token, reads/writes go to localStorage so local
// dev and previews without a store keep working (with a loud warning).

const OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
const STORE_ID = process.env.BLOB_STORE_ID;
const RW_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

const POOL_PREFIX = "pool";
const MANIFEST_PATH = `${POOL_PREFIX}/manifest.json`;
const FIGHTERS_PREFIX = `${POOL_PREFIX}/fighters`;

export const POOL_STORAGE_KEY = "infinite-arena:pool";

export function hasBlobStore(): boolean {
  return Boolean((OIDC_TOKEN && STORE_ID) || RW_TOKEN);
}

// Auth options the blob SDK understands: OIDC pair when available (rotates
// automatically, your protected store's native path), static token otherwise,
// nothing when unconfigured (falls back to the local pool).
function blobAuth():
  | { oidcToken: string; storeId: string }
  | { token: string | undefined } {
  if (OIDC_TOKEN && STORE_ID) {
    return { oidcToken: OIDC_TOKEN, storeId: STORE_ID };
  }
  return { token: RW_TOKEN };
}

let warnedFallback = false;

function warnFallbackOnce() {
  if (typeof window !== "undefined" || warnedFallback) return; // server-only
  warnedFallback = true;
  console.warn(
    "[poolStore] no BLOB_READ_WRITE_TOKEN / OIDC pair — the community " +
      "pool is falling back to per-device localStorage. Fighters won't sync " +
      "across devices until a blob store is attached.",
  );
}

// ---------------------------------------------------------------------------
// Manifest helpers (git-blob index; order-only, never authoritative for content)

async function readManifest(): Promise<string[]> {
  if (!hasBlobStore()) return [];
  try {
    const { blobs } = await list({ prefix: MANIFEST_PATH, ...blobAuth() });
    if (blobs.length === 0) return [];
    const res = await fetch(blobs[0].url, { cache: "no-store" });
    if (!res.ok) return [];
    const ids = (await res.json()) as unknown;
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeManifest(ids: string[]): Promise<void> {
  if (!hasBlobStore()) return;
  await put(MANIFEST_PATH, JSON.stringify(ids), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    ...blobAuth(),
  });
}

// ---------------------------------------------------------------------------
// Fighter docs

async function writeFighterDoc(fighter: Fighter): Promise<void> {
  if (!hasBlobStore()) return;
  await put(
    `${FIGHTERS_PREFIX}/${fighter.id}.json`,
    JSON.stringify(fighter),
    {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      ...blobAuth(),
    },
  );
}

function asFighter(raw: unknown): Fighter | null {
  const parsed = FighterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Public server API

export async function listPoolFighters(): Promise<Fighter[]> {
  if (!hasBlobStore()) {
    warnFallbackOnce();
    return readLocalPool();
  }
  const [order, listing] = await Promise.all([
    readManifest(),
    list({ prefix: FIGHTERS_PREFIX, ...blobAuth() }),
  ]);
  const docs = await Promise.all(
    listing.blobs.map(async (blob) => {
      try {
        const res = await fetch(blob.url, { cache: "no-store" });
        if (!res.ok) return null;
        return asFighter(await res.json());
      } catch {
        return null;
      }
    }),
  );
  const fighters = docs.filter((f): f is Fighter => f !== null);
  const byId = new Map(fighters.map((f) => [f.id, f]));
  const ordered: Fighter[] = [];
  for (const id of order) {
    const f = byId.get(id);
    if (f) {
      ordered.push(f);
      byId.delete(id);
    }
  }
  // Any fighter not in the manifest yet (concurrent create) still shows up.
  ordered.push(...byId.values());
  return ordered;
}

export async function addPoolFighter(
  fighter: Pick<Fighter, "name" | "imageUrl" | "description" | "createdBy">,
): Promise<Fighter> {
  const full: Fighter = {
    ...fighter,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  if (!hasBlobStore()) {
    warnFallbackOnce();
    if (typeof window !== "undefined") {
      writeLocalPool([...readLocalPool(), full]);
    }
    return full;
  }
  await writeFighterDoc(full);
  const order = await readManifest();
  if (!order.includes(full.id)) {
    await writeManifest([...order, full.id]);
  }
  return full;
}

// ---------------------------------------------------------------------------
// Client-side fallback (localStorage) — used only from the POST handler when
// there's no blob token, and by the client store when told there's no pool.

export function readLocalPool(): Fighter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(POOL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed.map(asFighter).filter((f): f is Fighter => f !== null))
      : [];
  } catch {
    return [];
  }
}

export function writeLocalPool(fighters: Fighter[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POOL_STORAGE_KEY, JSON.stringify(fighters));
}
