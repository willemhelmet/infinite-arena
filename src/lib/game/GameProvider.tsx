"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { createGameClient } from "./createGameClient";
import type { GameClient } from "./gameClient";
import type { ClientEvent } from "./protocol";
import {
  gameReducer,
  initialGameState,
  type GameAction,
  type TypedGameState,
} from "./state";
import { getSelfPlayerId } from "@/lib/identity";

// The one component-level integration between the game client and React:
// a single GameClient for the app's lifetime, events reduced into
// TypedGameState, exposed via useGame(). This is the ONLY file that touches
// createGameClient — screens read state and dispatch ClientEvents, nothing else.

interface GameContextValue {
  state: TypedGameState;
  send: (event: ClientEvent) => void;
  dispatchUi: (action: GameAction) => void;
  selfPlayerId: string;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const clientRef = useRef<GameClient | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<ClientEvent[]>([]);
  const selfPlayerId = useMemo(
    () => (typeof window === "undefined" ? "" : getSelfPlayerId()),
    [],
  );

  useEffect(() => {
    if (!selfPlayerId) return;
    const client = createGameClient();
    clientRef.current = client;
    const unsubscribe = client.subscribe((event) => {
      dispatch({ type: "server", event });
    });
    void client.connect().then(() => {
      // Child components' effects fire before this one, so early sends (like
      // "list rooms on mount") were queued — flush them now that the client
      // can actually take events. Mirrors a real transport's connect race.
      readyRef.current = true;
      for (const event of pendingRef.current) client.send(event);
      pendingRef.current = [];
      dispatch({ type: "connected", selfPlayerId });
    });
    return () => {
      unsubscribe();
      client.disconnect();
      clientRef.current = null;
      readyRef.current = false;
      pendingRef.current = [];
    };
  }, [selfPlayerId]);

  // Must be referentially stable across state changes: any effect that lists
  // `send` as a dep would otherwise re-fire on every server event (which is
  // precisely how a "list rooms on mount" effect becomes an infinite loop).
  const send = useCallback((event: ClientEvent) => {
    if (readyRef.current && clientRef.current) {
      clientRef.current.send(event);
    } else {
      pendingRef.current.push(event);
    }
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({
      state,
      selfPlayerId,
      send,
      dispatchUi: dispatch,
    }),
    [state, selfPlayerId, send],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}
