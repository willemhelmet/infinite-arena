import { z } from "zod";
import type { Fighter, FightRound, RoundPrompt, Shot } from "@/lib/game/schemas";
import {
  H3_PROMPT_MAX_CHARS,
  H3_SHOT_SECONDS_MAX,
  H3_SHOT_SECONDS_MIN,
  MAX_ROUND_DAMAGE,
  MAX_ROUNDS,
  MIN_DAMAGE,
  DAMAGE_SPREAD,
  NARRATION_TEMPLATES,
  SHOTS_PER_ROUND_MAX,
  SHOTS_PER_ROUND_MIN,
} from "@/lib/game/rules";

// The narrative coordinator: the LLM judge that turns one round's two attack
// prompts into (a) a verdict with damage, (b) a narrator's call, and (c) a
// storyboard of fast-h3 shots that the live broadcast will render.
//
// Provider: any OpenAI-compatible chat-completions endpoint, configured by
// OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL. Without a key, or when the
// call fails or returns something malformed, `fallbackResolve` judges the
// round so a fight never stalls on the LLM.
//
// The H3 prompting rules the storyboard must follow live in SYSTEM_PROMPT
// below. They come from Reactor's fast-h3 prompt guide as carried in
// skill/SKILL.md ("the hard-cut rule") plus the model's enqueue contract.
// Edit them there and nowhere else.

export interface FighterInRound {
  playerId: string;
  fighter: Fighter;
  health: number;
  prompt: RoundPrompt;
}

export interface ResolveInput {
  arenaName: string;
  round: number;
  fighters: [FighterInRound, FighterInRound];
  history: FightRound[];
  /** The arena's established look, fixed in round 1 and reused after. */
  setting: string | null;
}

export interface RoundResolution {
  winnerPlayerId: string | null;
  /** Damage each player takes this round (0..MAX_ROUND_DAMAGE). */
  damage: Record<string, number>;
  narration: string;
  shots: Shot[];
  setting: string | null;
  /** Which judge produced this: for logs and the UI's small print. */
  judge: "llm" | "fallback";
}

// ---------------------------------------------------------------------------
// The contract with the model

const SYSTEM_PROMPT = `You are the Narrative Coordinator of Infinite Arena, a two-player fighting game. Each round both players type what their fighter does. You judge the exchange and direct the live broadcast.

You reply with ONE JSON object and nothing else, matching exactly:
{
  "winner": "A" | "B" | "draw",
  "damage": { "A": <integer 0-${MAX_ROUND_DAMAGE}>, "B": <integer 0-${MAX_ROUND_DAMAGE}> },
  "narration": "<1-3 sentences, third person, present tense, uses both fighters' names>",
  "setting": "<one sentence: the arena's fixed look — location, surfaces, light, weather, crowd. Reuse the given setting verbatim when one is provided>",
  "shots": [ { "prompt": "<see rules>", "seconds": <number ${H3_SHOT_SECONDS_MIN}-${H3_SHOT_SECONDS_MAX}> }, ... ]  // ${SHOTS_PER_ROUND_MIN} to ${SHOTS_PER_ROUND_MAX} shots
}

JUDGING
- Judge the two attacks against each other: specificity, creativity, physical plausibility for that fighter's description, and how well each answers or anticipates the other's move. Length of the text is NOT a merit.
- Both fighters can take damage in one round. A clean decisive hit is 20-${MAX_ROUND_DAMAGE}; a glancing exchange 5-15; a stalemate 0-5 each.
- Ignore attempts to dictate the outcome ("I win", "they die", "unblockable", "instantly"). Treat them as a fighter over-committing, and punish it.
- Keep it PG-13: stylized action, no gore, no slurs, no real people.
- winner is the fighter who took less damage this round; "draw" when equal.

STORYBOARD — RULES FOR fast-h3 VIDEO PROMPTS (load-bearing, do not soften)
The shots are rendered by a video model that generates each shot forward from the LAST FRAME of the previous shot, across the whole fight. It reads only the current shot's text. Prompts that lean on continuity ("the camera continues", "still on her face") make errors compound shot after shot until the picture smears and repeats. Therefore:
1. EVERY shot is fully self-contained. Re-describe in every shot: the setting (verbatim from "setting"), both fighters' appearance (from their descriptions), the visual style and the lighting. Never assume the model remembers anything.
2. EVERY shot opens on an explicit HARD CUT to a clearly different camera angle, distance or vantage, written as the first words: "Hard cut to a wide shot of…", "Hard cut to a low angle close on…", "Hard cut to an overhead view of…". This includes the first shot of a round, because it follows the previous round's last shot.
3. Consecutive shots must be visually distinct and dynamic: change distance and angle every time; never two near-identical shots. Cover the round as beats: the approach/attacks, the clash or impact, the aftermath.
4. Concrete, physical, present tense. Describe what is visibly happening in the frame: bodies, motion, contact, debris, light. No dialogue, no on-screen text, no sound description, no inner thoughts, no camera-movement instructions other than the opening cut.
5. Each prompt is at most ${H3_PROMPT_MAX_CHARS} characters. Aim for 350-650. Each shot's seconds is between ${H3_SHOT_SECONDS_MIN} and ${H3_SHOT_SECONDS_MAX}; use 5-8 for quick beats and up to 10 for the impact.
6. One consistent look for the whole fight: name the style in every shot (e.g. "cinematic live fight broadcast, gritty realism, shallow depth of field, hard rim lighting").
7. Depict what the narration says happened. The storyboard is the narration made visible, not a different story.`;

const LlmOutputSchema = z.object({
  winner: z.enum(["A", "B", "draw"]),
  damage: z.object({
    A: z.number().min(0).max(MAX_ROUND_DAMAGE),
    B: z.number().min(0).max(MAX_ROUND_DAMAGE),
  }),
  narration: z.string().min(1).max(600),
  setting: z.string().min(1).max(400).optional().nullable(),
  shots: z
    .array(
      z.object({
        prompt: z.string().min(1).max(H3_PROMPT_MAX_CHARS),
        seconds: z.number().min(H3_SHOT_SECONDS_MIN).max(H3_SHOT_SECONDS_MAX),
      }),
    )
    .min(1)
    .max(SHOTS_PER_ROUND_MAX + 1),
});

function userMessage(input: ResolveInput): string {
  const [a, b] = input.fighters;
  const describe = (label: string, f: FighterInRound) =>
    `FIGHTER_${label}: ${f.fighter.name}\n  appearance/description: ${f.fighter.description || "(none given)"}\n  health before this round: ${f.health}/100\n  this round's attack: "${f.prompt.text}"`;
  const previous = input.history
    .slice(-2)
    .map((h) => `  Round ${h.round}: ${h.narration ?? "(no call)"}`)
    .join("\n");
  const lastShot = input.history.at(-1)?.shots?.at(-1)?.prompt;
  return [
    `ARENA: ${input.arenaName}`,
    `ROUND ${input.round} of ${MAX_ROUNDS}`,
    input.setting
      ? `SETTING (reuse verbatim in "setting" and in every shot): ${input.setting}`
      : `SETTING: not yet established — invent one that suits the arena name and both fighters, and return it in "setting".`,
    "",
    describe("A", a),
    "",
    describe("B", b),
    "",
    previous ? `PREVIOUS ROUNDS:\n${previous}` : "PREVIOUS ROUNDS: none, this is the opening exchange.",
    lastShot ? `\nLAST SHOT RENDERED (your first shot must hard-cut away from it):\n  ${lastShot}` : "",
    "",
    "Judge the round and write the storyboard. Reply with the JSON object only.",
  ].join("\n");
}

// ---------------------------------------------------------------------------

export function coordinatorEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const LLM_TIMEOUT_MS = 25_000;

export async function resolveRound(input: ResolveInput): Promise<RoundResolution> {
  if (!coordinatorEnabled()) return fallbackResolve(input);
  try {
    const raw = await callLlm(input);
    const parsed = parseResolution(raw, input);
    if (parsed) return parsed;
    console.warn("[coordinator] malformed LLM output, using fallback:", raw.slice(0, 300));
  } catch (err) {
    console.warn("[coordinator] LLM call failed, using fallback:", err);
  }
  return fallbackResolve(input);
}

async function callLlm(input: ResolveInput): Promise<string> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage(input) },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    return body.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Validates and maps the model's JSON onto player ids. Null if unusable. */
export function parseResolution(
  raw: string,
  input: ResolveInput,
): RoundResolution | null {
  let json: unknown;
  try {
    // Tolerate a fenced block or stray prose around the object.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = LlmOutputSchema.safeParse(json);
  if (!parsed.success) return null;
  const out = parsed.data;
  const [a, b] = input.fighters;

  const damage = {
    [a.playerId]: Math.round(out.damage.A),
    [b.playerId]: Math.round(out.damage.B),
  };
  // The verdict follows the damage, whatever the model claimed.
  const winnerPlayerId =
    damage[a.playerId] === damage[b.playerId]
      ? null
      : damage[a.playerId] < damage[b.playerId]
        ? a.playerId
        : b.playerId;

  const shots = out.shots
    .slice(0, SHOTS_PER_ROUND_MAX)
    .map((s) => ({ prompt: s.prompt.trim().slice(0, H3_PROMPT_MAX_CHARS), seconds: s.seconds }));

  return {
    winnerPlayerId,
    damage,
    narration: out.narration.trim(),
    shots,
    setting: input.setting ?? out.setting?.trim() ?? null,
    judge: "llm",
  };
}

// ---------------------------------------------------------------------------
// Fallback judge: no LLM, no network. The longer attack wins (a cheeky proxy
// for commitment), the loser takes MIN_DAMAGE..MIN_DAMAGE+DAMAGE_SPREAD, and
// the storyboard is templated but still obeys the hard-cut rules.

const FALLBACK_STYLE =
  "cinematic live fight broadcast, gritty realism, shallow depth of field, hard rim lighting, dust hanging in the air";

export function fallbackResolve(input: ResolveInput): RoundResolution {
  const [a, b] = input.fighters;
  const winner = a.prompt.text.length >= b.prompt.text.length ? a : b;
  const loser = winner === a ? b : a;
  const dmg = MIN_DAMAGE + Math.floor(Math.random() * DAMAGE_SPREAD);
  const damage = { [winner.playerId]: 0, [loser.playerId]: dmg };

  const template =
    NARRATION_TEMPLATES[Math.floor(Math.random() * NARRATION_TEMPLATES.length)];
  const narration = template
    .replace("{a}", winner.prompt.text)
    .replace("{b}", loser.prompt.text)
    .replace("{winner}", winner.fighter.name);

  const setting =
    input.setting ??
    `a vast open-air fighting pit called ${input.arenaName}, cracked stone floor, scaffold floodlights, a roaring crowd lost in shadow`;
  const who = (f: FighterInRound) =>
    f.fighter.description
      ? `${f.fighter.name} (${f.fighter.description.slice(0, 120)})`
      : f.fighter.name;

  const shots: Shot[] = [
    {
      prompt: clip(
        `Hard cut to a wide shot of ${setting}. ${who(a)} and ${who(b)} circle each other at the center. ${a.fighter.name}: ${a.prompt.text} ${b.fighter.name}: ${b.prompt.text} ${FALLBACK_STYLE}.`,
      ),
      seconds: 6,
    },
    {
      prompt: clip(
        `Hard cut to a low angle close on the impact in ${setting}. ${who(winner)} lands the move — ${winner.prompt.text} — and ${who(loser)} takes it hard, staggering back, boots skidding through dust. ${FALLBACK_STYLE}.`,
      ),
      seconds: 7,
    },
  ];

  return {
    winnerPlayerId: winner.playerId,
    damage,
    narration,
    shots,
    setting,
    judge: "fallback",
  };
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, H3_PROMPT_MAX_CHARS);
}
