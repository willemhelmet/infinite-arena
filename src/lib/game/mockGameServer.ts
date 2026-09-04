"use client";

import {
  BOT_JOIN_DELAY_MS,
  BOT_NARRATIONS,
  BOT_PROMPT_DELAY_MS,
  BOT_PROMPTS,
  BOT_READY_DELAY_MIN_MS,
  BOT_READY_DELAY_SPREAD_MS,
  CORRIDOR_BOT,
  COUNTDOWN_FROM,
  COUNTDOWN_TICK_MS,
  MAX_ROUNDS,
  ROUND_RESOLVE_DELAY_MS,
  SEED_BOTS,
  jitter,
} from "./mockBotBehavior";
import type { GameClient } from "./gameClient";
import type { ClientEvent, ServerEvent } from "./protocol";
import type {
  Fighter,
  FightResult,
  FightRound,
  PlayerSlot,
  Room,
  RoomSummary,
  RoundPrompt,
} from "@/lib/game/schemas";
import { getFighter } from "@/lib/fighters/roster";
import { getSelfPlayerId } from "@/lib/identity";

// A fully client-side GameClient: rooms live in memory, a bot fills the other
// slot, and a canned fight loop resolves rounds immediately after both
// "attacks" are in. Behaves the way a real WS server will — asynchronous,
// event-driven, state-authoritative — so the swap later is invisible to screens.
//
// In-memory only on purpose: a refresh re-seeds. The prototype-regret is
// acceptable; state that must survive (fighters) lives in the roster store.

interface FightLoopState {
  round: number;
  prompts: RoundPrompt[];
  history: FightRound[];
  previousClipId?: string; // reserved for the live H3 phase
}

interface RoomRuntime {
  room: Room;
  fight: FightLoopState | null;
  countingDown: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

type Listener = (event: ServerEvent) => void;

export class MockGameServer implements GameClient {
  private rooms = new Map<string, RoomRuntime>();
  private listeners = new Set<Listener>();
  private connected = false;
  private seeded = false;
  private selfId = "";

  async connect(): Promise<void> {
    this.connected = true;
    this.selfId = getSelfPlayerId();
    if (!this.seeded) {
      this.seeded = true;
      for (const bot of SEED_BOTS) {
        const room = this.makeRoom(
          bot.arenaName,
          "public",
          `bot-${bot.arenaName}`,
          bot.fighter,
        );
        this.rooms.set(room.id, { room, fight: null, countingDown: false, timers: [] });
      }
    }
  }

  disconnect(): void {
    for (const rt of this.rooms.values()) rt.timers.forEach(clearTimeout);
    this.rooms.clear();
    this.listeners.clear();
    this.connected = false;
    this.seeded = false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(event: ClientEvent): void {
    if (!this.connected) {
      queueMicrotask(() =>
        this.emit({ type: "server_error", message: "Not connected." }),
      );
      return;
    }
    switch (event.type) {
      case "list_rooms":
        queueMicrotask(() =>
          this.emit({ type: "room_list", rooms: this.roomSummaries() }),
        );
        break;
      case "create_room":
        this.handleCreateRoom(event);
        break;
      case "join_room":
        this.handleJoinRoom(event);
        break;
      case "set_ready":
        this.handleSetReady(event);
        break;
      case "leave_room":
        this.handleLeaveRoom(event);
        break;
      case "submit_prompt":
        this.handleSubmitPrompt(event);
        break;
      case "request_rematch":
        this.handleRematch(event);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers

  private handleCreateRoom(event: Extract<ClientEvent, { type: "create_room" }>) {
    const fighter = getFighter(event.hostFighterId);
    if (!fighter) {
      queueMicrotask(() =>
        this.emit({ type: "server_error", message: "Pick a fighter first." }),
      );
      return;
    }
    const room = this.makeRoom(event.name, event.visibility, this.selfId, fighter);
    const runtime: RoomRuntime = { room, fight: null, countingDown: false, timers: [] };
    this.rooms.set(room.id, runtime);
    queueMicrotask(() => this.emit({ type: "room_state", room }));
    // A challenger walks in from the corridor.
    runtime.timers.push(
      setTimeout(() => {
        this.addBotToRoom(runtime, CORRIDOR_BOT.fighter);
        this.pushRoom(runtime);
      }, BOT_JOIN_DELAY_MS),
    );
  }

  private handleJoinRoom(event: Extract<ClientEvent, { type: "join_room" }>) {
    const runtime = this.rooms.get(event.roomId);
    const fighter = getFighter(event.fighterId);
    if (!runtime) {
      queueMicrotask(() =>
        this.emit({ type: "server_error", message: "That arena is gone." }),
      );
      return;
    }
    if (!fighter) {
      queueMicrotask(() =>
        this.emit({ type: "server_error", message: "Pick a fighter first." }),
      );
      return;
    }
    const [, slot2] = runtime.room.players;
    if (slot2 !== null && slot2.playerId !== this.selfId) {
      queueMicrotask(() =>
        this.emit({
          type: "server_error",
          message: "That arena is already full.",
        }),
      );
      return;
    }
    if (runtime.room.players[0].playerId === this.selfId) {
      // Re-joining own room — just re-broadcast state.
      queueMicrotask(() =>
        this.emit({ type: "room_state", room: runtime.room }),
      );
      return;
    }
    runtime.room.players[1] = this.makeSelfSlot(fighter);
    runtime.room = { ...runtime.room, status: "in_lobby" };
    queueMicrotask(() => this.emit({ type: "room_state", room: runtime.room }));
  }

  private handleSetReady(event: Extract<ClientEvent, { type: "set_ready" }>) {
    const runtime = this.rooms.get(event.roomId);
    if (!runtime) return;
    this.mapSelfSlot(runtime, (slot) => ({ ...slot, ready: event.ready }));
    this.pushRoom(runtime);

    if (event.ready) {
      // The bot readies shortly after the human does.
      runtime.timers.push(
        setTimeout(
          () => {
            this.mapBotSlot(runtime, (slot) => ({ ...slot, ready: true }));
            this.pushRoom(runtime);
            this.maybeStartCountdown(runtime);
          },
          BOT_READY_DELAY_MIN_MS + jitter(BOT_READY_DELAY_SPREAD_MS),
        ),
      );
    }
    this.maybeStartCountdown(runtime);
  }

  private handleLeaveRoom(event: Extract<ClientEvent, { type: "leave_room" }>) {
    const runtime = this.rooms.get(event.roomId);
    if (!runtime) return;
    runtime.timers.forEach(clearTimeout);
    this.rooms.delete(event.roomId);
  }

  private handleSubmitPrompt(
    event: Extract<ClientEvent, { type: "submit_prompt" }>,
  ) {
    const runtime = this.rooms.get(event.roomId);
    const fight = runtime?.fight;
    if (!runtime || !fight || fight.round !== event.round) return;
    if (fight.prompts.some((p) => p.playerId === this.selfId)) return;
    fight.prompts.push({
      playerId: this.selfId,
      text: event.prompt.trim().slice(0, 280),
      submittedAt: Date.now(),
    });
    // The bot fires its own attack a beat later.
    const bot = runtime.room.players.find((p) => p?.isBot);
    if (bot && !fight.prompts.some((p) => p.playerId === bot.playerId)) {
      runtime.timers.push(
        setTimeout(() => {
          fight.prompts.push({
            playerId: bot.playerId,
            text: BOT_PROMPTS[jitter(BOT_PROMPTS.length)],
            submittedAt: Date.now(),
          });
          this.resolveRound(runtime);
        }, BOT_PROMPT_DELAY_MS),
      );
    } else {
      this.resolveRound(runtime);
    }
  }

  private handleRematch(event: Extract<ClientEvent, { type: "request_rematch" }>) {
    const runtime = this.rooms.get(event.roomId);
    if (!runtime) return;
    runtime.timers.forEach(clearTimeout);
    runtime.fight = null;
    runtime.countingDown = false;
    for (const [i, slot] of runtime.room.players.entries()) {
      if (slot) runtime.room.players[i] = { ...slot, ready: false, health: 100 };
    }
    runtime.room = { ...runtime.room, status: "in_lobby" };
    queueMicrotask(() => this.emit({ type: "room_state", room: runtime.room }));
    // The bot is always up for a rematch.
    if (runtime.room.players[1]?.isBot) {
      runtime.timers.push(
        setTimeout(() => {
          this.mapBotSlot(runtime, (slot) => ({ ...slot, ready: true }));
          this.pushRoom(runtime);
        }, BOT_READY_DELAY_MIN_MS + jitter(BOT_READY_DELAY_SPREAD_MS)),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // The fight loop

  private maybeStartCountdown(runtime: RoomRuntime) {
    const [host, opponent] = runtime.room.players;
    if (!host?.ready || !opponent?.ready || runtime.fight || runtime.countingDown) return;
    runtime.countingDown = true;
    runtime.room = { ...runtime.room, status: "in_fight" };
    let remaining = COUNTDOWN_FROM;
    const tick = () => {
      if (!this.rooms.has(runtime.room.id)) return;
      this.emit({
        type: "countdown_tick",
        roomId: runtime.room.id,
        secondsRemaining: remaining,
      });
      if (remaining <= 0) {
        this.startFight(runtime);
        return;
      }
      remaining -= 1;
      runtime.timers.push(setTimeout(tick, COUNTDOWN_TICK_MS));
    };
    this.pushRoom(runtime);
    runtime.timers.push(setTimeout(tick, COUNTDOWN_TICK_MS));
  }

  private startFight(runtime: RoomRuntime) {
    runtime.countingDown = false;
    runtime.fight = { round: 1, prompts: [], history: [] };
    this.emit({ type: "fight_started", roomId: runtime.room.id });
    this.emit({
      type: "round_started",
      roomId: runtime.room.id,
      round: this.currentFightRound(runtime),
    });
    this.pushRoom(runtime);
  }

  private resolveRound(runtime: RoomRuntime) {
    const fight = runtime.fight;
    if (!fight || fight.prompts.length < 2) return;
    const [host, opponent] = runtime.room.players;
    if (!host || !opponent) return;

    // Resolve: in the graybox the round simply favors whoever submitted the
    // longer attack text (a cheeky proxy for "commitment"), with the loser
    // dropping 10-24 health. The real coordinator replaces this entirely.
    const [promptA, promptB] = fight.prompts;
    const selfPrompt = fight.prompts.find((p) => p.playerId === this.selfId);
    const botPrompt = fight.prompts.find((p) => p.playerId !== this.selfId);
    const winner = promptA.text.length >= promptB.text.length ? promptA : promptB;
    const loser = winner === promptA ? promptB : promptA;
    const damage = 10 + jitter(15);

    const template = BOT_NARRATIONS[jitter(BOT_NARRATIONS.length)];
    const a = selfPrompt?.text ?? "their attack";
    const b = botPrompt?.text ?? "the counter";
    const narration = template
      .replace("{a}", a)
      .replace("{b}", b)
      .replace("{winner}", winner.playerId === this.selfId ? "You" : "They");

    const healthAfter: Record<string, number> = {
      [host.playerId]: host.health,
      [opponent.playerId]: opponent.health,
    };
    healthAfter[loser.playerId] = Math.max(0, healthAfter[loser.playerId] - damage);

    const resolved: FightRound = {
      round: fight.round,
      prompts: [...fight.prompts],
      narration,
      healthAfter,
    };
    fight.history.push(resolved);

    runtime.timers.push(
      setTimeout(() => {
        if (!this.rooms.has(runtime.room.id) || !runtime.fight) return;
        // Apply health to the room state.
        for (const [i, slot] of runtime.room.players.entries()) {
          if (slot)
            runtime.room.players[i] = {
              ...slot,
              health: healthAfter[slot.playerId] ?? slot.health,
            };
        }
        this.emit({ type: "narration", roomId: runtime.room.id, round: resolved.round, text: narration });
        this.emit({ type: "round_resolved", roomId: runtime.room.id, round: resolved });
        this.pushRoom(runtime);

        const dead = runtime.room.players.some((p) => (p?.health ?? 100) <= 0);
        if (dead || fight.round >= MAX_ROUNDS) {
          this.endFight(runtime);
        } else {
          runtime.fight = { ...fight, round: fight.round + 1, prompts: [] };
          this.emit({
            type: "round_started",
            roomId: runtime.room.id,
            round: this.currentFightRound(runtime),
          });
        }
      }, ROUND_RESOLVE_DELAY_MS),
    );
  }

  private endFight(runtime: RoomRuntime) {
    const fight = runtime.fight;
    if (!fight) return;
    const [host, opponent] = runtime.room.players;
    const healthOf = (slot: PlayerSlot | null) => slot?.health ?? 0;
    let winnerPlayerId: string | null = null;
    if (host && opponent && healthOf(host) !== healthOf(opponent)) {
      winnerPlayerId =
        healthOf(host) > healthOf(opponent) ? host.playerId : opponent.playerId;
    }
    const result: FightResult = {
      winnerPlayerId,
      rounds: [...fight.history],
      endedAt: Date.now(),
    };
    runtime.fight = null;
    // Snap the room out to clients BEFORE the verdict lands: a room_state
    // arriving after fight_ended reads as a reset/rematch signal to the
    // client's state machine and would cancel the results navigation.
    this.pushRoom(runtime);
    this.emit({ type: "fight_ended", roomId: runtime.room.id, result });
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private currentFightRound(runtime: RoomRuntime): FightRound {
    const fight = runtime.fight!;
    const [host, opponent] = runtime.room.players;
    const healthAfter: Record<string, number> = {};
    if (host) healthAfter[host.playerId] = host.health;
    if (opponent) healthAfter[opponent.playerId] = opponent.health;
    return {
      round: fight.round,
      prompts: [...fight.prompts],
      narration: null,
      healthAfter,
    };
  }

  private roomSummaries(): RoomSummary[] {
    return [...this.rooms.values()].map(({ room }) => ({
      id: room.id,
      name: room.name,
      hostFighterName: room.hostFighterName,
      status: room.status,
      visibility: room.visibility,
    }));
  }

  private makeRoom(
    name: string,
    visibility: "public" | "private",
    hostPlayerId: string,
    hostFighter: Fighter,
  ): Room {
    return {
      id: crypto.randomUUID().slice(0, 8),
      name: name || "Unnamed Arena",
      hostFighterName: hostFighter.name,
      status: visibility === "public" ? "open" : "in_lobby",
      visibility,
      hostPlayerId,
      players: [
        {
          playerId: hostPlayerId,
          isBot: hostPlayerId.startsWith("bot-"),
          fighter: hostFighter,
          ready: false,
          health: 100,
        },
        null,
      ],
    };
  }

  private makeSelfSlot(fighter: Fighter): PlayerSlot {
    return {
      playerId: this.selfId,
      isBot: false,
      fighter,
      ready: false,
      health: 100,
    };
  }

  private addBotToRoom(runtime: RoomRuntime, fighter: Fighter) {
    runtime.room.players[1] = {
      playerId: `bot-${crypto.randomUUID().slice(0, 6)}`,
      isBot: true,
      fighter,
      ready: false,
      health: 100,
    };
    runtime.room = { ...runtime.room, status: "in_lobby" };
  }

  private mapSelfSlot(runtime: RoomRuntime, fn: (slot: PlayerSlot) => PlayerSlot) {
    for (const [i, slot] of runtime.room.players.entries()) {
      if (slot && slot.playerId === this.selfId) runtime.room.players[i] = fn(slot);
    }
  }

  private mapBotSlot(runtime: RoomRuntime, fn: (slot: PlayerSlot) => PlayerSlot) {
    for (const [i, slot] of runtime.room.players.entries()) {
      if (slot?.isBot) runtime.room.players[i] = fn(slot);
    }
  }

  private pushRoom(runtime: RoomRuntime) {
    this.emit({ type: "room_state", room: { ...runtime.room, players: [...runtime.room.players] } });
  }

  private emit(event: ServerEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
