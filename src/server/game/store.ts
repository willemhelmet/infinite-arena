import type { ServerEvent } from "@/lib/game/protocol";
import type {
  FightResult,
  FightRound,
  Room,
  RoomSummary,
  RoundPrompt,
} from "@/lib/game/schemas";
import { ROOM_TTL_SECONDS } from "@/lib/game/rules";
import { getKV } from "./kv";

// Persistence for rooms: the record, its append-only event log, the public
// listing, and the player → room index. Everything expires with ROOM_TTL so
// abandoned arenas clean themselves up.

export interface FightState {
  round: number;
  prompts: RoundPrompt[];
  history: FightRound[];
}

export interface RoomRecord {
  room: Room;
  fight: FightState | null;
  /** Set while both players are ready and the gates are closing. */
  countdownStartedAt: number | null;
  /** How many countdown_tick events this countdown has emitted so far. */
  ticksEmitted: number;
  /** The last verdict, kept until a rematch so a reconnecting client can land on it. */
  lastResult: FightResult | null;
  updatedAt: number;
}

const roomKey = (id: string) => `arena:room:${id}`;
const eventsKey = (id: string) => `arena:room:${id}:events`;
const lockKey = (id: string) => `arena:room:${id}:lock`;
const playerKey = (playerId: string) => `arena:player:${playerId}:room`;
const PUBLIC_ROOMS = "arena:rooms:public";

export async function loadRoom(id: string): Promise<RoomRecord | null> {
  const raw = await getKV().get(roomKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RoomRecord;
  } catch {
    return null;
  }
}

export async function saveRoom(record: RoomRecord): Promise<void> {
  record.updatedAt = Date.now();
  await getKV().set(roomKey(record.room.id), JSON.stringify(record), ROOM_TTL_SECONDS);
}

export async function deleteRoom(id: string): Promise<void> {
  const kv = getKV();
  await kv.srem(PUBLIC_ROOMS, id);
  await kv.del(roomKey(id), eventsKey(id));
}

export async function appendEvents(
  roomId: string,
  events: ServerEvent[],
): Promise<number> {
  if (events.length === 0) return getKV().llen(eventsKey(roomId));
  return getKV().rpush(
    eventsKey(roomId),
    events.map((e) => JSON.stringify(e)),
    ROOM_TTL_SECONDS,
  );
}

export async function readEvents(
  roomId: string,
  from: number,
): Promise<ServerEvent[]> {
  const raw = await getKV().lrange(eventsKey(roomId), from, -1);
  return raw.map((r) => JSON.parse(r) as ServerEvent);
}

export async function eventCount(roomId: string): Promise<number> {
  return getKV().llen(eventsKey(roomId));
}

export async function publishRoom(id: string): Promise<void> {
  await getKV().sadd(PUBLIC_ROOMS, id, ROOM_TTL_SECONDS);
}

export async function unpublishRoom(id: string): Promise<void> {
  await getKV().srem(PUBLIC_ROOMS, id);
}

export async function listPublicRooms(): Promise<RoomSummary[]> {
  const kv = getKV();
  const ids = await kv.smembers(PUBLIC_ROOMS);
  const records = await Promise.all(ids.map((id) => loadRoom(id)));
  const summaries: RoomSummary[] = [];
  for (const [i, record] of records.entries()) {
    if (!record) {
      // Expired or deleted without cleanup — drop it from the listing.
      void kv.srem(PUBLIC_ROOMS, ids[i]);
      continue;
    }
    summaries.push(toSummary(record.room));
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export function toSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    hostFighterName: room.hostFighterName,
    status: room.status,
    visibility: room.visibility,
  };
}

export async function getPlayerRoom(playerId: string): Promise<string | null> {
  return getKV().get(playerKey(playerId));
}

export async function setPlayerRoom(playerId: string, roomId: string) {
  await getKV().set(playerKey(playerId), roomId, ROOM_TTL_SECONDS);
}

export async function clearPlayerRoom(playerId: string) {
  await getKV().del(playerKey(playerId));
}

// ---------------------------------------------------------------------------
// A per-room mutex. Vercel runs requests concurrently, and two players can
// act on the same room in the same second, so every read-modify-write of a
// room runs under this lock.

const LOCK_TTL_MS = 3000;
const LOCK_RETRY_MS = 40;
const LOCK_ATTEMPTS = 100;

export class RoomBusyError extends Error {
  constructor() {
    super("The arena is busy — try again.");
  }
}

export async function withRoomLock<T>(
  roomId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const kv = getKV();
  const token = crypto.randomUUID();
  let acquired = false;
  for (let i = 0; i < LOCK_ATTEMPTS && !acquired; i++) {
    acquired = await kv.setIfAbsent(lockKey(roomId), token, LOCK_TTL_MS);
    if (!acquired) await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  if (!acquired) throw new RoomBusyError();
  try {
    return await fn();
  } finally {
    // Only release our own lock: if it expired and someone else holds it, a
    // blind delete would free their lock. (Small race if it expires between
    // the read and the delete; acceptable at this TTL.)
    if ((await kv.get(lockKey(roomId))) === token) await kv.del(lockKey(roomId));
  }
}
