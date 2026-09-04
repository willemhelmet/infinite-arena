import type { Fighter } from "@/lib/game/schemas";

// Tuning + flavor content for the mock server's simulated opponent. Every
// timer is a named constant so tests can reason about them, and NEXT_PUBLIC_MOCK_FAST
// scales them all down (÷10) so Playwright doesn't wait real seconds.

const FAST =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_MOCK_FAST === "1";
const SPEED = FAST ? 0.1 : 1;

export const BOT_JOIN_DELAY_MS = 1500 * SPEED;
export const BOT_READY_DELAY_MIN_MS = 1000 * SPEED;
export const BOT_READY_DELAY_SPREAD_MS = 2000 * SPEED;
export const COUNTDOWN_TICK_MS = 1000 * SPEED;
export const COUNTDOWN_FROM = 3;
export const BOT_PROMPT_DELAY_MS = 1200 * SPEED;
export const ROUND_RESOLVE_DELAY_MS = 600 * SPEED;

export const MAX_ROUNDS = 5;

export function jitter(spread: number): number {
  return Math.floor(Math.random() * spread);
}

// --- Seeded rooms on the join list -------------------------------------------

export interface BotSpec {
  fighter: Fighter;
  arenaName: string;
}

export const SEED_BOTS: BotSpec[] = [
  {
    arenaName: "Rustbelt Rumble",
    fighter: {
      id: "bot-fighter-1",
      name: "Karg the Rusted",
      imageUrl: "https://placehold.co/512x512/3f3f46/e4e4e7/png?text=KARG",
      description: "A salvage titan who welded his own heart to a reactor core.",
      createdBy: "bot",
    },
  },
  {
    arenaName: "Neon Dojo",
    fighter: {
      id: "bot-fighter-2",
      name: "Vesper Coil",
      imageUrl: "https://placehold.co/512x512/1e1b4b/c7d2fe/png?text=VESPER",
      description: "A holographic duelist who fights one second in the future.",
      createdBy: "bot",
    },
  },
  {
    arenaName: "The Salt Circle",
    fighter: {
      id: "bot-fighter-3",
      name: "Brine Wretch",
      imageUrl: "https://placehold.co/512x512/134e4a/99f6e4/png?text=BRINE",
      description: "It crawled out of the harbor and demands a referee.",
      createdBy: "bot",
    },
  },
];

// A corridor bot for rooms the player hosts.
export const CORRIDOR_BOT: BotSpec = {
  arenaName: "",
  fighter: {
    id: "bot-fighter-challenger",
    name: "Challenger",
    imageUrl: "https://placehold.co/512x512/7f1d1d/fecaca/png?text=YOU?",
    description: "A wandering duelist who smelled fresh arena paint.",
    createdBy: "bot",
  },
};

// --- Fight flavor --------------------------------------------------------------

export const BOT_PROMPTS = [
  "Spins low and sweeps at their opponent's ankles.",
  "Hurls a chunk of debris straight at their face.",
  "Fakes left, then drives a shoulder into their ribs.",
  "Leaps off the arena wall for a descending elbow.",
  "Taunts them loudly, demanding they make the first move.",
  "Breathes deep, then charges headlong with horns down.",
  "Ducks behind cover and starts circling for an opening.",
  "Unleashes a flurry of jabs, ending on a haymaker.",
];

// Templated with both fighters' actions; {a} = moving fighter's action,
// {b} = the opposing action, {winner} = who the resolve favored.
export const BOT_NARRATIONS = [
  "{a} — and it lands clean. The {b} isn't fast enough to stop it.",
  "They trade blows: {a}, answered by {b}. The crowd loses its mind.",
  "{a}. But {b} turns the exchange around at the last breath.",
  "The arena shakes as {a} collides with {b} midway.",
  "{a} looks decisive — until {b} proves it was a trap.",
];
