"use client";

import { useState } from "react";
import { ArenaButton } from "@/components/ArenaButton";

const MAX_CHARS = 280;

export function PromptInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setText("");
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        placeholder="What does your fighter do? ('I duck the haymaker and counter with an uppercut to their reactor core…')"
        rows={2}
        disabled={disabled}
        data-testid="attack-input"
        className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600 disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-zinc-600">
          {text.length}/{MAX_CHARS}
        </span>
        <ArenaButton
          disabled={disabled || !text.trim()}
          onClick={handleSubmit}
          testId="attack-submit"
          className="min-w-40"
        >
          {disabled ? "Move locked in" : "ATTACK"}
        </ArenaButton>
      </div>
    </div>
  );
}
