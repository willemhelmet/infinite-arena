import { z } from "zod";
import { FighterSchema } from "@/lib/game/schemas";

// The shared vocabulary between the broadcaster (Python, broadcaster/) and
// the web app: what the channel is showing right now, and the chat the game
// is played in. The broadcaster PUTs ShowState; the /watch page GETs it.

export const ContestantSchema = z.object({
  handle: z.string().min(1).max(32),
  playerId: z.string().min(1).max(64),
  fighter: FighterSchema,
  health: z.number().min(0).max(100),
  /** Whether this side's attack for the open round is already in. */
  attacked: z.boolean(),
});
export type Contestant = z.infer<typeof ContestantSchema>;

export const ShowFightSchema = z.object({
  id: z.string(),
  a: ContestantSchema,
  b: ContestantSchema,
  round: z.number().int().min(0),
  maxRounds: z.number().int().positive(),
  /** open: attacks accepted · judging: coordinator running · playing: the round's shots are on air */
  roundState: z.enum(["open", "judging", "playing"]),
  /** Epoch ms when the open round auto-resolves without a missing attack. */
  deadlineAt: z.number().nullable(),
  narration: z.string().nullable(),
  winnerHandle: z.string().nullable().optional(),
});
export type ShowFight = z.infer<typeof ShowFightSchema>;

export const QueueEntrySchema = z.object({
  handle: z.string(),
  fighterName: z.string(),
});

export const ShowStateSchema = z.object({
  /** offline: no broadcaster · idle: bios · card: next fight announced · fight · verdict */
  program: z.enum(["offline", "idle", "card", "fight", "verdict"]),
  updatedAt: z.number(),
  /** What the metadata echo says is on air right now, for the panel. */
  nowPlaying: z.string().nullable(),
  fight: ShowFightSchema.nullable(),
  queue: z.array(QueueEntrySchema),
  /** Playout queue depth / capacity, for the "building · ready" badge. */
  queued: z.object({ building: z.number(), ready: z.number() }).optional(),
});
export type ShowState = z.infer<typeof ShowStateSchema>;

export const OFFLINE_SHOW: ShowState = {
  program: "offline",
  updatedAt: 0,
  nowPlaying: null,
  fight: null,
  queue: [],
};

export const ChatMessageSchema = z.object({
  seq: z.number().int(),
  id: z.string(),
  ts: z.number(),
  /** user: a viewer · system: the arena (queue, round calls) · narrator: the coordinator's calls */
  kind: z.enum(["user", "system", "narrator"]),
  handle: z.string(),
  playerId: z.string().nullable(),
  text: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const CHAT_TEXT_MAX = 280;
export const HANDLE_RE = /^[A-Za-z0-9_]{2,20}$/;

/** The commands the broadcaster understands. Shown on /watch as help. */
export const CHAT_COMMANDS: { command: string; help: string }[] = [
  { command: "!fight <fighter>", help: "Enter the queue with one of the arena's fighters (see View Fighters)." },
  { command: "!attack <what you do>", help: "Your move for the open round. One per round, 280 characters." },
  { command: "!leave", help: "Step out of the queue." },
  { command: "!fighters", help: "List the fighters you can enter with." },
  { command: "!queue", help: "Who's lined up to fight next." },
];
