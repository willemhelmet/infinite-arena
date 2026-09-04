import type { ClientEvent, ServerEvent } from "./protocol";

// The seam. Every screen talks to this interface; the implementation is a
// MockGameServer today and a WsGameClient tomorrow. Swapping implementations
// means writing one new class and changing one factory — zero screen changes.

export interface GameClient {
  connect(): Promise<void>;
  disconnect(): void;
  send(event: ClientEvent): void;
  /** Subscribe to server events. Returns an unsubscribe function. */
  subscribe(listener: (event: ServerEvent) => void): () => void;
}
