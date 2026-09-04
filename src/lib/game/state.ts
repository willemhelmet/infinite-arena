import type {
  FightResult,
  FightRound,
  Room,
  RoomSummary,
} from "@/lib/game/schemas";
import type { ServerEvent } from "./protocol";

// The single reduction of every server event into one screen-consumable
// state object. Phases are coarse enough that screens gate themselves on
// `phase` plus the specific payload they need.

export type GamePhase =
  | "menu"
  | "browsing_games"
  | "creating_server"
  | "lobby"
  | "countdown"
  | "fight"
  | "results";

export interface TypedGameState {
  phase: GamePhase;
  roomList: RoomSummary[];
  room: Room | null;
  countdown: number | null;
  currentRound: FightRound | null;
  roundHistory: FightRound[];
  narrations: { round: number; text: string }[];
  result: FightResult | null;
  error: string | null;
  connected: boolean;
}

export const initialGameState: TypedGameState = {
  phase: "menu",
  roomList: [],
  room: null,
  countdown: null,
  currentRound: null,
  roundHistory: [],
  narrations: [],
  result: null,
  error: null,
  connected: false,
};

export type GameAction =
  | { type: "connected"; selfPlayerId: string }
  | { type: "ui_enter_games" }
  | { type: "ui_enter_create_server" }
  | { type: "ui_enter_menu" }
  | { type: "server"; event: ServerEvent };

export function gameReducer(
  state: TypedGameState,
  action: GameAction,
): TypedGameState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true };
    case "ui_enter_games":
      return { ...state, phase: "browsing_games", error: null };
    case "ui_enter_create_server":
      return { ...state, phase: "creating_server", error: null };
    case "ui_enter_menu":
      return {
        ...initialGameState,
        connected: state.connected,
      };
    case "server":
      return reduceServerEvent(state, action.event);
  }
}

function reduceServerEvent(
  state: TypedGameState,
  event: ServerEvent,
): TypedGameState {
  switch (event.type) {
    case "room_list":
      return { ...state, roomList: event.rooms };
    case "room_closed":
      // The arena we were in is gone (host left, or it expired). Back to the
      // list, with the reason surfaced; screens navigate on the phase change.
      return {
        ...initialGameState,
        connected: state.connected,
        phase: "browsing_games",
        roomList: state.roomList,
        error: event.reason,
      };
    case "room_state": {
      if (state.phase === "fight" || state.phase === "countdown") {
        // Mid-fight room updates (health application) shouldn't kick us out.
        return { ...state, room: event.room };
      }
      if (state.phase === "results") {
        // A room_state on the verdict screen only means rematch/reset when the
        // room actually reset (everyone stood down) — plain heartbeats (like
        // the server's post-fight push) must not cancel the results screen.
        const reset = event.room.players.every((p) => !p?.ready);
        if (!reset) return { ...state, room: event.room };
        return {
          ...state,
          room: event.room,
          phase: "lobby",
          result: null,
          roundHistory: [],
          narrations: [],
          currentRound: null,
        };
      }
      return { ...state, room: event.room, phase: "lobby" };
    }
    case "countdown_tick":
      if (event.secondsRemaining <= 0) {
        return { ...state, countdown: null, phase: "fight" };
      }
      return { ...state, countdown: event.secondsRemaining, phase: "countdown" };
    case "fight_started":
      return {
        ...state,
        phase: "fight",
        countdown: null,
        currentRound: null,
        roundHistory: [],
        narrations: [],
        result: null,
      };
    case "round_started":
      return { ...state, currentRound: event.round, phase: "fight" };
    case "round_updated":
      return { ...state, currentRound: event.round };
    case "narration":
      return {
        ...state,
        narrations: [...state.narrations, { round: event.round, text: event.text }],
      };
    case "round_resolved":
      return {
        ...state,
        roundHistory: [...state.roundHistory, event.round],
      };
    case "fight_ended":
      return { ...state, phase: "results", result: event.result, countdown: null };
    case "server_error":
      return { ...state, error: event.message };
  }
}
