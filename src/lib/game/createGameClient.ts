import type { GameClient } from "./gameClient";
import { MockGameServer } from "./mockGameServer";

// The ONE line that changes when real infra arrives: swap MockGameServer for
// a WebSocket/oRPC client here (or branch on an env flag), and every screen
// keeps working untouched.
export function createGameClient(): GameClient {
  return new MockGameServer();
}
