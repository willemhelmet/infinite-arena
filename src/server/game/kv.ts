import { Redis } from "@upstash/redis";

// The key-value layer under the game store. Two implementations:
//
// - UpstashKV: Upstash Redis over REST, which is what Vercel functions can
//   reach. Vercel injects the credentials when a Redis store is attached to
//   the project (Storage tab → Marketplace → Upstash). Both the Upstash and
//   the legacy Vercel KV variable names are accepted.
// - MemoryKV: a process-local map for `pnpm dev`, `next start`, and the e2e
//   suite. It is a single process there, so it behaves like Redis would.
//   It never applies in a multi-instance deployment: without Redis creds on
//   Vercel, every function instance would have its own memory and rooms
//   would not be shared — exactly the bug this layer exists to fix — so the
//   factory refuses to fall back to memory when VERCEL is set.

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET NX PX — true if the key was absent and is now set. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  /** Appends values, refreshes the TTL, returns the new list length. */
  rpush(key: string, values: string[], ttlSeconds: number): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  sadd(key: string, member: string, ttlSeconds: number): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------

class UpstashKV implements KV {
  constructor(private redis: Redis) {}

  async get(key: string) {
    return (await this.redis.get<string>(key)) ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    const res = await this.redis.set(key, value, { nx: true, px: ttlMs });
    return res === "OK";
  }
  async del(...keys: string[]) {
    if (keys.length) await this.redis.del(...keys);
  }
  async rpush(key: string, values: string[], ttlSeconds: number) {
    const [len] = await this.redis
      .pipeline()
      .rpush(key, ...values)
      .expire(key, ttlSeconds)
      .exec<[number, number]>();
    return len;
  }
  async lrange(key: string, start: number, stop: number) {
    return this.redis.lrange<string>(key, start, stop);
  }
  async llen(key: string) {
    return this.redis.llen(key);
  }
  async sadd(key: string, member: string, ttlSeconds: number) {
    await this.redis.pipeline().sadd(key, member).expire(key, ttlSeconds).exec();
  }
  async srem(key: string, member: string) {
    await this.redis.srem(key, member);
  }
  async smembers(key: string) {
    return this.redis.smembers<string[]>(key);
  }
}

// ---------------------------------------------------------------------------

type Entry =
  | { kind: "string"; value: string; expiresAt: number }
  | { kind: "list"; value: string[]; expiresAt: number }
  | { kind: "set"; value: Set<string>; expiresAt: number };

class MemoryKV implements KV {
  private map = new Map<string, Entry>();

  private live<K extends Entry["kind"]>(
    key: string,
    kind: K,
  ): Extract<Entry, { kind: K }> | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.kind === kind ? (e as Extract<Entry, { kind: K }>) : null;
  }

  async get(key: string) {
    return this.live(key, "string")?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.map.set(key, {
      kind: "string",
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key, "string")) return false;
    this.map.set(key, { kind: "string", value, expiresAt: Date.now() + ttlMs });
    return true;
  }
  async del(...keys: string[]) {
    for (const k of keys) this.map.delete(k);
  }
  async rpush(key: string, values: string[], ttlSeconds: number) {
    const e = this.live(key, "list") ?? {
      kind: "list" as const,
      value: [] as string[],
      expiresAt: 0,
    };
    e.value.push(...values);
    e.expiresAt = Date.now() + ttlSeconds * 1000;
    this.map.set(key, e);
    return e.value.length;
  }
  async lrange(key: string, start: number, stop: number) {
    const list = this.live(key, "list")?.value ?? [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }
  async llen(key: string) {
    return this.live(key, "list")?.value.length ?? 0;
  }
  async sadd(key: string, member: string, ttlSeconds: number) {
    const e = this.live(key, "set") ?? {
      kind: "set" as const,
      value: new Set<string>(),
      expiresAt: 0,
    };
    e.value.add(member);
    e.expiresAt = Date.now() + ttlSeconds * 1000;
    this.map.set(key, e);
  }
  async srem(key: string, member: string) {
    this.live(key, "set")?.value.delete(member);
  }
  async smembers(key: string) {
    return [...(this.live(key, "set")?.value ?? [])];
  }
}

// ---------------------------------------------------------------------------

// Cached on globalThis so `next dev` module reloads don't wipe MemoryKV.
const globalStore = globalThis as unknown as { __arenaKV?: KV };

export function getKV(): KV {
  if (globalStore.__arenaKV) return globalStore.__arenaKV;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  let kv: KV;
  if (url && token) {
    kv = new UpstashKV(new Redis({ url, token, automaticDeserialization: false }));
  } else if (process.env.VERCEL) {
    throw new Error(
      "No Redis configured. Attach an Upstash Redis store to this Vercel " +
        "project (Storage → Marketplace) so rooms are shared across devices.",
    );
  } else {
    kv = new MemoryKV();
  }
  globalStore.__arenaKV = kv;
  return kv;
}

export function hasSharedStore(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN),
  );
}
