"use client";

import { Modal } from "@/components/Modal";

const STEPS: { title: string; body: string }[] = [
  {
    title: "1. Forge a fighter",
    body: "Describe your champion and let AI forge their portrait — or upload your own image. Name them. They're yours forever.",
  },
  {
    title: "2. Find the arena",
    body: "Join someone else's arena or host your own. Two fighters only — this is a duel, not a brawl.",
  },
  {
    title: "3. Ready up",
    body: "Both fighters pick their champion and hit READY. When both are locked in, the countdown begins: 3… 2… 1…",
  },
  {
    title: "4. Fight",
    body: "Each round, type what your fighter does. Dodge, strike, taunt, transform — the arena's AI narrator resolves both moves into the next scene of a live fight broadcast.",
  },
  {
    title: "5. The verdict",
    body: "When the dust settles, the narrator crowns a winner. Rematch to settle the score, or walk away a legend.",
  },
];

export function HowToPlayModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <div data-testid="how-to-play">
        <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-100">
          How to play
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          The arena speaks in AI-generated video. Your words are the fight.
        </p>
        <ol className="mt-4 flex flex-col gap-4">
          {STEPS.map((step) => (
            <li key={step.title}>
              <h3 className="text-sm font-semibold text-zinc-200">
                {step.title}
              </h3>
              <p className="mt-0.5 text-sm leading-6 text-zinc-400">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-md border border-zinc-700 px-4 py-2 text-sm uppercase tracking-wider text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
