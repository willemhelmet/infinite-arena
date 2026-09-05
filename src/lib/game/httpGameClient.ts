"use client";

import type { GameClient } from "./gameClient";
import type {
  ClientEvent,
  EventCursor,
  ServerEvent,
  SyncResponse,
} from "./protocol";
import { POLL_INTERVAL_MS } from "./rules";
import { getSelfPlayerId } from "@/lib/identity";

// The networked GameClient: commands go up as POSTs, state comes back by
// polling the room's event log. The server is authoritative; this class
// only tracks where in the log it is (the cursor) and drops duplicates when a
// poll and a POST return overlapping ranges.

type Listener = (event: ServerEvent) => void;

const isReplyOnly = (e: ServerEvent) =>
  e.type === "server_error" || e.type === "room_list";

export class HttpGameClient implements GameClient {
  private listeners = new Set<Listener>();
  private cursor: EventCursor | null = null;
  private playerId = "";
  private connected = false;
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    this.playerId = getSelfPlayerId();
    this.connected = true;
    await this.poll();
    this.schedule();
  }

  disconnect(): void {
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(event: ClientEvent): void {
    if (event.type === "leave_room") {
      // We chose to go: don't read the resulting empty cursor as "closed".
      this.cursor = null;
    }
    void this.post(event);
  }

  // ---------------------------------------------------------------------------

  private headers() {
    return { "Content-Type": "application/json", "x-player-id": this.playerId };
  }

  private async post(event: ClientEvent) {
    try {
      const res = await fetch("/api/game/events", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ event, cursor: this.cursor }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        this.emit({
          type: "server_error",
          message: body.error ?? `The arena refused that (${res.status}).`,
        });
        return;
      }
      this.apply((await res.json()) as SyncResponse);
    } catch {
      this.emit({ type: "server_error", message: "Lost contact with the arena." });
    }
  }

  private async poll() {
    if (this.polling || !this.connected) return;
    this.polling = true;
    try {
      const params = new URLSearchParams();
      if (this.cursor) {
        params.set("roomId", this.cursor.roomId);
        params.set("seq", String(this.cursor.seq));
      }
      const res = await fetch(`/api/game/poll?${params}`, {
        headers: this.headers(),
        cache: "no-store",
      });
      if (res.ok) this.apply((await res.json()) as SyncResponse);
    } catch {
      // Transient; the next tick retries.
    } finally {
      this.polling = false;
    }
  }

  private schedule() {
    if (!this.connected) return;
    this.timer = setTimeout(async () => {
      await this.poll();
      this.schedule();
    }, POLL_INTERVAL_MS);
  }

  private apply(sync: SyncResponse) {
    if (!this.connected) return;
    const before = this.cursor;
    // Reply-only events (errors, room lists) never enter a room's log, so
    // they sit outside the cursor arithmetic below.
    const replies = sync.events.filter(isReplyOnly);
    let log = sync.events.filter((e) => !isReplyOnly(e));

    if (sync.cursor && before && sync.cursor.roomId === before.roomId) {
      if (sync.from !== null) {
        // Delta for the room we follow: skip anything already delivered by a
        // request that raced ahead of this one.
        const skip = Math.max(0, before.seq - sync.from);
        log = log.slice(skip);
        this.cursor = {
          roomId: before.roomId,
          seq: Math.max(before.seq, sync.cursor.seq),
        };
      } else {
        // A snapshot for a room we already follow (rare): trust it.
        this.cursor = sync.cursor;
      }
    } else {
      if (before && !sync.cursor) {
        this.emit({
          type: "room_closed",
          roomId: before.roomId,
          reason: "That arena has closed.",
        });
      }
      this.cursor = sync.cursor;
    }

    for (const event of replies) this.emit(event);
    for (const event of log) this.emit(event);
  }

  private emit(event: ServerEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
