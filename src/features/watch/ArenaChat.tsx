"use client";

import { useEffect, useRef, useState } from "react";
import { ArenaButton } from "@/components/ArenaButton";
import { getSelfPlayerId } from "@/lib/identity";
import { CHAT_COMMANDS, CHAT_TEXT_MAX, HANDLE_RE, type ChatMessage, type ShowState } from "@/lib/show/schema";

const HANDLE_KEY = "infinite-arena:handle";

// The chat the game is played in. Commands are plain messages; the
// broadcaster reads them and answers as "Arena" or "Narrator".
export function ArenaChat({
  messages,
  show,
  onSent,
}: {
  messages: ChatMessage[];
  show: ShowState;
  onSent: () => void;
}) {
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setHandle(window.localStorage.getItem(HANDLE_KEY) ?? "");
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleOk = HANDLE_RE.test(handle);

  async function send() {
    const text = draft.trim();
    if (!text || !handleOk || sending) return;
    setSending(true);
    setError(null);
    try {
      window.localStorage.setItem(HANDLE_KEY, handle);
    } catch {
      // ignore
    }
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-player-id": getSelfPlayerId() },
        body: JSON.stringify({ text, handle }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Could not send (${res.status}).`);
      } else {
        setDraft("");
        onSent();
      }
    } catch {
      setError("Could not reach the arena.");
    } finally {
      setSending(false);
    }
  }

  const inFight = Boolean(show.fight && [show.fight.a, show.fight.b].some((s) => s.handle === handle));

  return (
    <div className="flex flex-col gap-2" data-testid="arena-chat">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">Arena chat</h2>
        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer select-none hover:text-zinc-300">Commands</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {CHAT_COMMANDS.map((c) => (
              <li key={c.command}>
                <span className="font-mono text-zinc-300">{c.command}</span> — {c.help}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div
        ref={listRef}
        className="flex h-64 flex-col gap-1 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm"
        data-testid="chat-log"
      >
        {messages.length === 0 && (
          <p className="text-xs italic text-zinc-600">Nothing yet. Say hello, or !fight.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="leading-5" data-testid="chat-message">
            <span
              className={
                m.kind === "narrator"
                  ? "font-semibold text-brand"
                  : m.kind === "system"
                    ? "font-semibold text-emerald-400"
                    : m.handle === handle
                      ? "font-semibold text-zinc-100"
                      : "font-semibold text-zinc-400"
              }
            >
              {m.handle}
            </span>
            <span className={m.kind === "narrator" ? "italic text-zinc-300" : "text-zinc-300"}> {m.text}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value.slice(0, 20))}
          placeholder="handle"
          data-testid="chat-handle"
          className="w-28 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CHAT_TEXT_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder={
            inFight && show.fight?.roundState === "open"
              ? "!attack <what your fighter does>"
              : "say something, or !fight <fighter>"
          }
          data-testid="chat-input"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
        />
        <ArenaButton
          disabled={!handleOk || !draft.trim() || sending}
          onClick={() => void send()}
          testId="chat-send"
        >
          Send
        </ArenaButton>
      </div>
      {!handleOk && handle.length > 0 && (
        <p className="text-[11px] text-zinc-500">Handles are 2-20 letters, digits or underscores.</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
