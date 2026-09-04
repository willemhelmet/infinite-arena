import { z } from "zod";

// The typed models for the whole game. These schemas validate at both of the
// graybox's untrusted boundaries: API route bodies (image routes) and
// localStorage reads (roster), and they define the types the mock server and
// every screen share. A real WS server will speak these exact shapes.

export const FighterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  imageUrl: z.string().url(),
  description: z.string().max(500),
  createdBy: z.string(),
});
export type Fighter = z.infer<typeof FighterSchema>;

export const PlayerSlotSchema = z.object({
  playerId: z.string(),
  isBot: z.boolean(),
  fighter: FighterSchema.nullable(),
  ready: z.boolean(),
  health: z.number().min(0).max(100),
});
export type PlayerSlot = z.infer<typeof PlayerSlotSchema>;

export const RoomSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  hostFighterName: z.string(),
  status: z.enum(["open", "in_lobby", "in_fight", "full"]),
  visibility: z.enum(["public", "private"]),
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

export const RoomSchema = RoomSummarySchema.extend({
  players: z.tuple([PlayerSlotSchema, PlayerSlotSchema.nullable()]),
  hostPlayerId: z.string(),
});
export type Room = z.infer<typeof RoomSchema>;

export const RoundPromptSchema = z.object({
  playerId: z.string(),
  text: z.string().min(1).max(280),
  submittedAt: z.number(),
});
export type RoundPrompt = z.infer<typeof RoundPromptSchema>;

// One clip for the fast-h3 model: a self-contained prompt (≤ 800 chars, the
// model's limit) and a length inside the model's producible range. Shots
// within a round chain into one continuous broadcast via continue_from_clip_id.
export const ShotSchema = z.object({
  prompt: z.string().min(1).max(800),
  seconds: z.number().min(5.167).max(14.375),
});
export type Shot = z.infer<typeof ShotSchema>;

export const FightRoundSchema = z.object({
  round: z.number().int().positive(),
  prompts: z.array(RoundPromptSchema).max(2),
  narration: z.string().nullable(),
  healthAfter: z.record(z.string(), z.number()),
  // The storyboard the coordinator produced for this round. Optional only
  // because rounds stored before shots existed lack it.
  shots: z.array(ShotSchema).optional(),
});
export type FightRound = z.infer<typeof FightRoundSchema>;

export const FightResultSchema = z.object({
  winnerPlayerId: z.string().nullable(), // null = draw
  rounds: z.array(FightRoundSchema),
  endedAt: z.number(),
});
export type FightResult = z.infer<typeof FightResultSchema>;
