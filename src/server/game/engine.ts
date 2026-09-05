import type {
  ClientEvent,
  EventCursor,
  ServerEvent,
  SyncResponse,
} from "@/lib/game/protocol";
import type {
  Fighter,
  FightResult,
  FightRound,
  PlayerSlot,
  Room,
} from "@/lib/game/schemas";
import {
  COUNTDOWN_FROM,
  COUNTDOWN_TICK_MS,
  MAX_ROUNDS,
  RESOLVE_TIMEOUT_MS,
} from "@/lib/game/rules";
import {
  fallbackResolve,
  resolveRound as judgeRound,
  type FighterInRound,
  type ResolveInput,
  type RoundResolution,
} from "./coordinator";
import {
  appendEvents,
  clearPlayerRoom,
  deleteRoom,
  eventCount,
  getPlayerRoom,
  listPublicRooms,
  loadRoom,
  publishRoom,
  readEvents,
  saveRoom,
  setPlayerRoom,
  withRoomLock,
  type RoomRecord,
} from "./store";

// The authoritative game engine. It is stateless between requests: every
// handler loads a room under its lock, mutates it, appends the resulting
// ServerEvents to the room's log, and saves. Clients learn about changes by
// polling the log (see sync()). Time-driven transitions (the countdown) are
// advanced lazily by whichever request touches the room next — both players
// poll every second, so nothing waits long.
//
// Round resolution is the one slow step (the LLM coordinator can take many
// seconds), so it runs OUTSIDE the room lock: the second attack marks the
// round "resolving" and commits, the judge runs, then a fresh lock applies
// the verdict if the round is still the one it judged. Polls flow meanwhile.

// ---------------------------------------------------------------------------
// Transaction helper: collects the events one request produces for a room.

class RoomTx {
  events: ServerEvent[] = [];
  constructor(public record: RoomRecord) {}

  emit(event: ServerEvent) {
    this.events.push(event);
  }

  pushRoom() {
    const room = this.record.room;
    this.emit({
      type: "room_state",
      room: { ...room, players: [room.players[0], room.players[1]] },
    });
  }

  async commit() {
    await saveRoom(this.record);
    await appendEvents(this.record.room.id, this.events);
  }
}

const error = (message: string): ServerEvent => ({ type: "server_error", message });

// ---------------------------------------------------------------------------
// Public API

/** Applies one client event. Returns reply-only events (errors, room lists). */
export async function handleClientEvent(
  playerId: string,
  event: ClientEvent,
): Promise<ServerEvent[]> {
  switch (event.type) {
    case "list_rooms":
      return [{ type: "room_list", rooms: await listPublicRooms() }];
    case "create_room":
      return createRoom(playerId, event.name, event.visibility, event.fighter);
    case "join_room":
      return joinRoom(playerId, event.roomId, event.fighter);
    case "set_ready":
      return setReady(playerId, event.roomId, event.ready);
    case "leave_room":
      await leaveRoom(playerId, event.roomId);
      return [];
    case "submit_prompt": {
      const { reply, judge } = await submitPrompt(
        playerId,
        event.roomId,
        event.round,
        event.prompt,
      );
      if (judge) await resolvePendingRound(event.roomId, judge);
      return reply;
    }
    case "request_rematch":
      return requestRematch(playerId, event.roomId);
  }
}

/**
 * Brings a client up to date. If it already follows this room, returns the
 * events after its cursor; otherwise a snapshot that reconstructs the room's
 * current phase from scratch (fresh tab, refresh, or just joined).
 */
export async function sync(
  playerId: string,
  cursor: EventCursor | null,
): Promise<SyncResponse> {
  const roomId = await getPlayerRoom(playerId);
  if (!roomId) return roomless();

  return withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    if (!record || !slotOf(record, playerId)) {
      await clearPlayerRoom(playerId);
      if (!record) await deleteRoom(roomId);
      return roomless();
    }

    const tx = new RoomTx(record);
    advance(tx, Date.now());
    if (tx.events.length > 0) await tx.commit();

    if (cursor && cursor.roomId === roomId) {
      const events = await readEvents(roomId, cursor.seq);
      return {
        cursor: { roomId, seq: cursor.seq + events.length },
        from: cursor.seq,
        events,
      };
    }
    const seq = await eventCount(roomId);
    return { cursor: { roomId, seq }, from: null, events: snapshot(record) };
  });
}

async function roomless(): Promise<SyncResponse> {
  return {
    cursor: null,
    from: null,
    events: [{ type: "room_list", rooms: await listPublicRooms() }],
  };
}

// ---------------------------------------------------------------------------
// Handlers

async function createRoom(
  playerId: string,
  name: string,
  visibility: Room["visibility"],
  fighter: Fighter,
): Promise<ServerEvent[]> {
  const existing = await getPlayerRoom(playerId);
  if (existing) await leaveRoom(playerId, existing);

  const room: Room = {
    id: crypto.randomUUID().slice(0, 8),
    name: name.trim() || `${fighter.name}'s Arena`,
    hostFighterName: fighter.name,
    status: "open",
    visibility,
    hostPlayerId: playerId,
    players: [makeSlot(playerId, fighter), null],
  };
  const record: RoomRecord = {
    room,
    fight: null,
    countdownStartedAt: null,
    ticksEmitted: 0,
    lastResult: null,
    updatedAt: Date.now(),
  };
  const tx = new RoomTx(record);
  tx.pushRoom();
  await tx.commit();
  if (visibility === "public") await publishRoom(room.id);
  await setPlayerRoom(playerId, room.id);
  return [];
}

async function joinRoom(
  playerId: string,
  roomId: string,
  fighter: Fighter,
): Promise<ServerEvent[]> {
  const existing = await getPlayerRoom(playerId);
  if (existing && existing !== roomId) await leaveRoom(playerId, existing);

  return withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    if (!record) {
      await clearPlayerRoom(playerId);
      return [error("That arena is gone.")];
    }
    if (slotOf(record, playerId)) {
      // Already seated (a refresh, or a second tab). sync() will snapshot.
      await setPlayerRoom(playerId, roomId);
      return [];
    }
    if (record.room.players[1] !== null) {
      return [error("That arena is already full.")];
    }
    record.room.players[1] = makeSlot(playerId, fighter);
    record.room.status = "full";
    const tx = new RoomTx(record);
    tx.pushRoom();
    await tx.commit();
    await setPlayerRoom(playerId, roomId);
    return [];
  });
}

async function setReady(
  playerId: string,
  roomId: string,
  ready: boolean,
): Promise<ServerEvent[]> {
  return withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    if (!record) return [error("That arena is gone.")];
    const slot = slotOf(record, playerId);
    if (!slot) return [error("You are not in this arena.")];
    // Once the gates are closing (or the fight is on) the choice is locked.
    if (record.countdownStartedAt !== null || record.fight) return [];

    slot.ready = ready;
    const tx = new RoomTx(record);
    const [host, guest] = record.room.players;
    if (host.ready && guest?.ready) {
      record.countdownStartedAt = Date.now();
      record.ticksEmitted = 0;
      record.room.status = "in_fight";
      tx.pushRoom();
      advance(tx, record.countdownStartedAt); // emits the first tick now
    } else {
      tx.pushRoom();
    }
    await tx.commit();
    return [];
  });
}

async function leaveRoom(playerId: string, roomId: string): Promise<void> {
  await withRoomLock(roomId, async () => {
    await clearPlayerRoom(playerId);
    const record = await loadRoom(roomId);
    if (!record) return;
    const [host, guest] = record.room.players;
    const isHost = host.playerId === playerId;
    const isGuest = guest?.playerId === playerId;
    if (!isHost && !isGuest) return;

    // The host leaving, or anyone leaving mid-countdown or mid-fight, closes
    // the arena. The other player's next sync finds it gone and is told so.
    if (isHost || record.countdownStartedAt !== null || record.fight) {
      await deleteRoom(roomId);
      return;
    }
    record.room.players[1] = null;
    record.room.status = "open";
    record.lastResult = null;
    const tx = new RoomTx(record);
    tx.pushRoom();
    await tx.commit();
  });
}

async function submitPrompt(
  playerId: string,
  roomId: string,
  round: number,
  prompt: string,
): Promise<{ reply: ServerEvent[]; judge: ResolveInput | null }> {
  return withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    if (!record) return { reply: [error("That arena is gone.")], judge: null };
    if (!slotOf(record, playerId))
      return { reply: [error("You are not in this arena.")], judge: null };
    const fight = record.fight;
    if (!fight || fight.round !== round || fight.resolvingSince !== null)
      return { reply: [], judge: null }; // stale round or already judging
    if (fight.prompts.some((p) => p.playerId === playerId))
      return { reply: [], judge: null };

    fight.prompts.push({
      playerId,
      text: prompt.trim().slice(0, 280),
      submittedAt: Date.now(),
    });
    const tx = new RoomTx(record);
    let judge: ResolveInput | null = null;
    if (fight.prompts.length >= 2) {
      // Both moves are in. Freeze the round and hand it to the coordinator
      // after the lock is released; the storyboard follows in a moment.
      fight.resolvingSince = Date.now();
      judge = resolveInputFor(record);
    }
    tx.emit({ type: "round_updated", roomId, round: currentRound(record) });
    await tx.commit();
    return { reply: [], judge };
  });
}

/** Runs the judge outside the lock, then applies its verdict if still valid. */
async function resolvePendingRound(roomId: string, input: ResolveInput) {
  const resolution = await judgeRound(input);
  await withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    const fight = record?.fight;
    if (!record || !fight) return;
    // Someone else (the timeout path) may have resolved it while we judged.
    if (fight.round !== input.round || fight.resolvingSince === null) return;
    const tx = new RoomTx(record);
    applyResolution(tx, resolution);
    await tx.commit();
  });
}

async function requestRematch(
  playerId: string,
  roomId: string,
): Promise<ServerEvent[]> {
  return withRoomLock(roomId, async () => {
    const record = await loadRoom(roomId);
    if (!record) return [error("That arena is gone.")];
    if (!slotOf(record, playerId)) return [error("You are not in this arena.")];
    if (record.fight || !record.lastResult) return [];

    for (const [i, slot] of record.room.players.entries()) {
      if (slot) record.room.players[i] = { ...slot, ready: false, health: 100 };
    }
    record.lastResult = null;
    record.room.status = record.room.players[1] ? "full" : "open";
    const tx = new RoomTx(record);
    tx.pushRoom();
    await tx.commit();
    return [];
  });
}

// ---------------------------------------------------------------------------
// The fight loop

/** Emits any countdown ticks that are due, and starts the fight at zero. */
function advance(tx: RoomTx, now: number) {
  const record = tx.record;
  const fight = record.fight;
  if (
    fight?.resolvingSince !== null &&
    fight?.resolvingSince !== undefined &&
    now - fight.resolvingSince > RESOLVE_TIMEOUT_MS
  ) {
    // The request that was judging this round never came back (function
    // timeout, crash). Don't leave both players staring at a spinner.
    console.warn(`[engine] round ${fight.round} in ${record.room.id} timed out judging; fallback`);
    applyResolution(tx, fallbackResolve(resolveInputFor(record)));
  }
  if (record.countdownStartedAt === null) return;
  const elapsed = now - record.countdownStartedAt;
  while (
    record.ticksEmitted <= COUNTDOWN_FROM &&
    elapsed >= record.ticksEmitted * COUNTDOWN_TICK_MS
  ) {
    const secondsRemaining = COUNTDOWN_FROM - record.ticksEmitted;
    tx.emit({ type: "countdown_tick", roomId: record.room.id, secondsRemaining });
    record.ticksEmitted += 1;
    if (secondsRemaining <= 0) {
      startFight(tx);
      return;
    }
  }
}

function startFight(tx: RoomTx) {
  const record = tx.record;
  record.countdownStartedAt = null;
  record.fight = { round: 1, prompts: [], history: [], resolvingSince: null, setting: null };
  record.lastResult = null;
  tx.emit({ type: "fight_started", roomId: record.room.id });
  tx.emit({ type: "round_started", roomId: record.room.id, round: currentRound(record) });
  tx.pushRoom();
}

function resolveInputFor(record: RoomRecord): ResolveInput {
  const fight = record.fight!;
  const [host, guest] = record.room.players;
  const forSlot = (slot: PlayerSlot): FighterInRound => ({
    playerId: slot.playerId,
    fighter: slot.fighter!,
    health: slot.health,
    prompt: fight.prompts.find((p) => p.playerId === slot.playerId)!,
  });
  return {
    arenaName: record.room.name,
    round: fight.round,
    fighters: [forSlot(host), forSlot(guest!)],
    history: fight.history,
    setting: fight.setting,
  };
}

/** Writes the judge's verdict into the room: health, history, events, next round. */
function applyResolution(tx: RoomTx, resolution: RoundResolution) {
  const record = tx.record;
  const fight = record.fight;
  if (!fight) return;
  const roomId = record.room.id;

  const healthAfter: Record<string, number> = {};
  for (const [i, slot] of record.room.players.entries()) {
    if (!slot) continue;
    const health = Math.max(0, slot.health - (resolution.damage[slot.playerId] ?? 0));
    healthAfter[slot.playerId] = health;
    record.room.players[i] = { ...slot, health };
  }

  const resolved: FightRound = {
    round: fight.round,
    prompts: [...fight.prompts],
    narration: resolution.narration,
    healthAfter,
    shots: resolution.shots,
  };
  fight.history.push(resolved);
  fight.setting = resolution.setting ?? fight.setting;
  fight.resolvingSince = null;

  tx.emit({ type: "narration", roomId, round: resolved.round, text: resolution.narration });
  tx.emit({ type: "round_resolved", roomId, round: resolved });
  tx.pushRoom();

  const dead = record.room.players.some((p) => (p?.health ?? 100) <= 0);
  if (dead || fight.round >= MAX_ROUNDS) {
    endFight(tx);
  } else {
    record.fight = { ...fight, round: fight.round + 1, prompts: [], resolvingSince: null };
    tx.emit({ type: "round_started", roomId, round: currentRound(record) });
  }
}

function endFight(tx: RoomTx) {
  const record = tx.record;
  const fight = record.fight;
  if (!fight) return;
  const [host, guest] = record.room.players;
  let winnerPlayerId: string | null = null;
  if (guest && host.health !== guest.health) {
    winnerPlayerId = host.health > guest.health ? host.playerId : guest.playerId;
  }
  const result: FightResult = {
    winnerPlayerId,
    rounds: [...fight.history],
    endedAt: Date.now(),
  };
  record.fight = null;
  record.lastResult = result;
  record.room.status = "full";
  // room_state BEFORE the verdict: a room_state arriving on the results
  // screen reads as a rematch/reset signal to the client's state machine.
  tx.pushRoom();
  tx.emit({ type: "fight_ended", roomId: record.room.id, result });
}

// ---------------------------------------------------------------------------
// Snapshot: the events that rebuild a room's current phase from nothing.

function snapshot(record: RoomRecord): ServerEvent[] {
  const roomId = record.room.id;
  const events: ServerEvent[] = [{ type: "room_state", room: record.room }];
  if (record.countdownStartedAt !== null && record.ticksEmitted > 0) {
    events.push({
      type: "countdown_tick",
      roomId,
      secondsRemaining: COUNTDOWN_FROM - (record.ticksEmitted - 1),
    });
  }
  if (record.fight) {
    events.push({ type: "fight_started", roomId });
    for (const h of record.fight.history) {
      if (h.narration)
        events.push({ type: "narration", roomId, round: h.round, text: h.narration });
      events.push({ type: "round_resolved", roomId, round: h });
    }
    events.push({ type: "round_started", roomId, round: currentRound(record) });
  }
  if (record.lastResult) {
    events.push({ type: "fight_ended", roomId, result: record.lastResult });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Helpers

function makeSlot(playerId: string, fighter: Fighter): PlayerSlot {
  return { playerId, isBot: false, fighter, ready: false, health: 100 };
}

function slotOf(record: RoomRecord, playerId: string): PlayerSlot | null {
  return record.room.players.find((p) => p?.playerId === playerId) ?? null;
}

function currentRound(record: RoomRecord): FightRound {
  const fight = record.fight!;
  const healthAfter: Record<string, number> = {};
  for (const p of record.room.players) if (p) healthAfter[p.playerId] = p.health;
  return {
    round: fight.round,
    prompts: [...fight.prompts],
    narration: null,
    healthAfter,
  };
}
