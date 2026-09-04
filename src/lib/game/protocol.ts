import type {
  Fighter,
  FightResult,
  FightRound,
  Room,
  RoomSummary,
} from "@/lib/game/schemas";

// The game's wire protocol — deliberately shaped the way a real WebSocket
// server would speak it, so the mock server and a future WsGameClient are
// interchangeable behind GameClient, and no screen ever needs to change.

export type ClientEvent =
  | { type: "list_rooms" }
  | {
      type: "create_room";
      name: string;
      visibility: "public" | "private";
      fighter: Fighter;
    }
  | { type: "join_room"; roomId: string; fighter: Fighter }
  | { type: "set_ready"; roomId: string; ready: boolean }
  | { type: "leave_room"; roomId: string }
  | { type: "submit_prompt"; roomId: string; round: number; prompt: string }
  | { type: "request_rematch"; roomId: string };

export type ServerEvent =
  | { type: "room_list"; rooms: RoomSummary[] }
  | { type: "room_state"; room: Room }
  | { type: "countdown_tick"; roomId: string; secondsRemaining: number }
  | { type: "fight_started"; roomId: string }
  | { type: "round_started"; roomId: string; round: FightRound }
  | { type: "narration"; roomId: string; round: number; text: string }
  | { type: "round_resolved"; roomId: string; round: FightRound }
  | { type: "fight_ended"; roomId: string; result: FightResult }
  | { type: "server_error"; message: string };
