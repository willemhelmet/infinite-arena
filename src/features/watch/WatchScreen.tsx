"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArenaPanel } from "@/components/ArenaPanel";
import { OFFLINE_SHOW, type ChatMessage, type ShowState } from "@/lib/show/schema";
import { ArenaChat } from "./ArenaChat";
import { ShowPanel } from "./ShowPanel";
import { StreamPlayer } from "./StreamPlayer";

const STREAM_URL = process.env.NEXT_PUBLIC_STREAM_URL ?? "";
const POLL_MS = 1500;

// The channel: the arena's own stream, what's on, and the chat the game is
// played in. Everything here is read by polling two small endpoints; the
// broadcaster (broadcaster/) is the only thing that writes show state.
export function WatchScreen() {
  const [show, setShow] = useState<ShowState>(OFFLINE_SHOW);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seqRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const [showRes, chatRes] = await Promise.all([
        fetch("/api/show", { cache: "no-store" }),
        fetch(`/api/chat?since=${seqRef.current}`, { cache: "no-store" }),
      ]);
      if (showRes.ok) setShow((await showRes.json()) as ShowState);
      if (chatRes.ok) {
        const body = (await chatRes.json()) as { seq: number; messages: ChatMessage[] };
        if (body.messages.length) {
          setMessages((prev) => [...prev, ...body.messages].slice(-300));
          seqRef.current = Math.max(seqRef.current, ...body.messages.map((m) => m.seq));
        }
        seqRef.current = Math.max(seqRef.current, body.seq);
      }
    } catch {
      // transient; next tick retries
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // First load: the recent backlog, then live deltas.
      try {
        const res = await fetch("/api/chat?since=0", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { seq: number; messages: ChatMessage[] };
          if (!alive) return;
          setMessages(body.messages.slice(-50));
          seqRef.current = body.seq;
        }
      } catch {
        // ignore
      }
      await poll();
    })();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [poll]);

  return (
    <div className="flex flex-col gap-4">
      <StreamPlayer src={STREAM_URL} offline={show.program === "offline"} />
      <ShowPanel show={show} />
      <ArenaPanel>
        <ArenaChat messages={messages} show={show} onSent={poll} />
      </ArenaPanel>
    </div>
  );
}
