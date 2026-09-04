import { z } from "zod";
import {
  FighterSchema,
  type FightResult,
  type FightRound,
  type Room,
  type RoomSummary,
} from "@/lib/game/schemas";

// The game's wire protocol. Clients send ClientEvents (validated on the
// server with ClientEventSchema, the single source of truth for their shape)
// and receive ServerEvents. The transport today is HTTP + polling
// (HttpGameClient ↔ /api/game/*); the event vocabulary is transport-agnostic
// so a WebSocket client can replace it without touching the screens.

export const ClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list_rooms") }),
  z.object({
    type: z.literal("create_room"),
    name: z.string().max(60),
    visibility: z.enum(["public", "private"]),
    // Fighters live in each browser's roster, so the client hands the server
    // the whole fighter at create/join time; the server never looks one up.
    fighter: FighterSchema,
  }),
  z.object({
    type: z.literal("join_room"),
    roomId: z.string().min(1).max(32),
    fighter: FighterSchema,
  }),
  z.object({
    type: z.literal("set_ready"),
    roomId: z.string().min(1).max(32),
    ready: z.boolean(),
  }),
  z.object({ type: z.literal("leave_room"), roomId: z.string().min(1).max(32) }),
  z.object({
    type: z.literal("submit_prompt"),
    roomId: z.string().min(1).max(32),
    round: z.number().int().positive(),
    prompt: z.string().min(1).max(280),
  }),
  z.object({
    type: z.literal("request_rematch"),
    roomId: z.string().min(1).max(32),
  }),
]);
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export type ServerEvent =
  | { type: "room_list"; rooms: RoomSummary[] }
  | { type: "room_state"; room: Room }
  | { type: "room_closed"; roomId: string; reason: string }
  | { type: "countdown_tick"; roomId: string; secondsRemaining: number }
  | { type: "fight_started"; roomId: string }
  | { type: "round_started"; roomId: string; round: FightRound }
  // The current round changed without resolving (an opponent locked in).
  | { type: "round_updated"; roomId: string; round: FightRound }
  | { type: "narration"; roomId: string; round: number; text: string }
  | { type: "round_resolved"; roomId: string; round: FightRound }
  | { type: "fight_ended"; roomId: string; result: FightResult }
  | { type: "server_error"; message: string };

// Where a client is in a room's event log. `seq` is the number of events
// already consumed; the server returns everything after it.
export interface EventCursor {
  roomId: string;
  seq: number;
}

// Every /api/game/* response has this shape. `from` is the seq the server
// read from (null when it sent a fresh snapshot instead of a delta), so the
// client can drop events a concurrent request already delivered.
export interface SyncResponse {
  cursor: EventCursor | null;
  from: number | null;
  events: ServerEvent[];
}
