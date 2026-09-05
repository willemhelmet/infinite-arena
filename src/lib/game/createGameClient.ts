import type { GameClient } from "./gameClient";
import { HttpGameClient } from "./httpGameClient";

// The one place the transport is chosen. HttpGameClient talks to
// /api/game/* (polling); a WebSocket client would slot in here later and
// every screen would keep working untouched.
export function createGameClient(): GameClient {
  return new HttpGameClient();
}
