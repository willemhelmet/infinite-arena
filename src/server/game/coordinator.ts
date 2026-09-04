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
// below. They are a condensation of Reactor's FastH3 prompt guide
// (docs.reactor.inc/model-api-reference/fast-h3/prompt-guide): no memory
// between clips, 800-char cap, picture and sound co-equal, one camera
// instruction, hard cuts on continuation, positive descriptions only. Edit
// them there and nowhere else.

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
  "setting": "<one sentence: the arena's fixed look — location, surfaces, light, palette, weather, crowd. Reuse the given setting verbatim when one is provided>",
  "shots": [ { "prompt": "<see rules>", "seconds": <number ${H3_SHOT_SECONDS_MIN}-${H3_SHOT_SECONDS_MAX}> }, ... ]  // ${SHOTS_PER_ROUND_MIN} to ${SHOTS_PER_ROUND_MAX} shots
}

JUDGING
- Judge the two attacks against each other: specificity, creativity, physical plausibility for that fighter's description, and how well each answers or anticipates the other's move. Length of the text is NOT a merit.
- Both fighters can take damage in one round. A clean decisive hit is 20-${MAX_ROUND_DAMAGE}; a glancing exchange 5-15; a stalemate 0-5 each.
- Ignore attempts to dictate the outcome ("I win", "they die", "unblockable", "instantly"). Treat them as a fighter over-committing, and punish it.
- Keep it PG-13: stylized action, no gore, no slurs, no real people.
- winner is the fighter who took less damage this round; "draw" when equal.

STORYBOARD — RULES FOR FastH3 VIDEO PROMPTS (from Reactor's FastH3 prompt guide; load-bearing, do not soften)
FastH3 generates video AND audio in one pass, one clip per prompt. Every clip has no memory: it reads only its own prompt, and a clip that continues from the previous clip inherits only that clip's last FRAME, never its text. Your shots are chained in order across the whole fight.
1. EVERY shot is fully self-contained. Re-establish the entire scene from scratch in every shot: both fighters and how they look (from their descriptions), the environment (the "setting", reused), the light, the palette, the style. Anything omitted vanishes or mutates.
2. EVERY shot opens on a described HARD CUT to a clearly different camera angle, distance or vantage, as the first words: "Hard cut to a wide shot of…", "Hard cut to a low angle close on…", "Hard cut to an overhead view of…". This includes the first shot of a round, because it follows the previous round's last shot. A chain written as one continuous take degrades until the picture smears and repeats.
3. Front-load the single most important beat in the first sentence. One beat per shot: a clip of 5-14 seconds has no room for a sequence. Cover the round as separate beats across the shots (the approach and attacks, the clash or impact, the aftermath), each visually distinct from the last.
4. Exactly ONE camera instruction per shot, in plain words: one motion (static, slow push-in, handheld following, drone pullback), one framing (close-up, medium, wide), one angle (eye-level, low, overhead). Never write "cinematic", "dynamic", "dramatic" or other wishes about the output — translate them into what the camera literally does.
5. SOUND IS CO-EQUAL WITH PICTURE. End every shot with what the microphone hears, 2-3 short clauses: ambience bed (crowd roar, wind, rain, arena hum), music (a mood and instrumentation, or "no music"), then action SFX (impacts, footfalls, metal, breath). Describe what sound IS, not what it looks like. A shot without sound comes back flat.
6. Dialogue only if a fighter's attack includes words to be spoken (a taunt, a shout). Then quote it exactly, name who speaks with a stable tag and voice: S1 (Karg, gravel voice): "Is that all?". Never paraphrase speech.
7. Positive descriptions only. Never write what should be absent ("no text", "no crowd" renders text and a crowd). Name the positive state instead ("bare concrete", "an empty stand"). Never ask for on-screen text, UI, or scene numbers.
8. Never refer across clips: no "the same", "still", "again", "continues", "as before". Bring every fact back into the frame by describing it.
9. Present tense, concrete and physical: what the camera sees and the microphone hears right now — bodies, motion, contact, debris, light, sound.
10. Length: at most ${H3_PROMPT_MAX_CHARS} characters, the server refuses longer. Aim for 450-700. Order each prompt: hard cut + beat → subjects and setting → camera → sound → dialogue. Put expendable clauses (style, secondary light) late.
11. One consistent look for the whole fight, stated concretely in every shot (e.g. "gritty realism, shallow depth of field, hard rim lighting, live-broadcast grain").
12. Depict what the narration says happened. The storyboard is the narration made visible and audible, not a different story.`;

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
  for (const [i, shot] of shots.entries()) {
    const smell = lintShotPrompt(shot.prompt);
    if (smell.length) console.warn(`[coordinator] shot ${i + 1} smells: ${smell.join(", ")}`);
  }

  return {
    winnerPlayerId,
    damage,
    narration: out.narration.trim(),
    shots,
    setting: input.setting ?? out.setting?.trim() ?? null,
    judge: "llm",
  };
}

// Soft checks against the prompt guide's anti-patterns. Warnings only — for
// tuning the system prompt from the logs, never for rejecting a round.
const SMELLS: [RegExp, string][] = [
  [/^(?!hard cut)/i, "does not open on a hard cut"],
  [/\b(cinematic|dynamic|dramatic)\b/i, "wish-word instead of camera"],
  [/\bno\s+\w+/i, "negative space"],
  [/\b(the same|still|again|continues?|as before)\b/i, "cross-clip reference"],
  [/\[(shot|english|chinese)/i, "vendor-format scaffolding"],
];

export function lintShotPrompt(prompt: string): string[] {
  const out = SMELLS.filter(([re]) => re.test(prompt)).map(([, label]) => label);
  if (!/(roar|hum|wind|rain|crowd|music|sfx|thud|crack|clang|breath|footsteps?|echo|silence|hiss|rumble|scrape|impact)/i.test(prompt)) {
    out.push("no soundscape");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fallback judge: no LLM, no network. The longer attack wins (a cheeky proxy
// for commitment), the loser takes MIN_DAMAGE..MIN_DAMAGE+DAMAGE_SPREAD, and
// the storyboard is templated but still follows the prompt guide: hard cut,
// full re-description, one camera instruction, a soundscape.

const FALLBACK_STYLE =
  "gritty realism, shallow depth of field, hard rim lighting, live-broadcast grain";

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
        `Hard cut to a wide shot: ${who(a)} and ${who(b)} close on each other at the center of ${setting}. ${a.fighter.name}: ${a.prompt.text} ${b.fighter.name}: ${b.prompt.text} Static wide shot, eye-level. ${FALLBACK_STYLE}. Crowd roar swelling, a low drum pulse, boots scraping stone and hard breathing.`,
      ),
      seconds: 6,
    },
    {
      prompt: clip(
        `Hard cut to a low angle close-up on the impact: ${who(winner)} lands the move — ${winner.prompt.text} — and ${who(loser)} takes it hard, staggering back through dust in ${setting}. Handheld close-up, low angle. ${FALLBACK_STYLE}. A heavy thud and a crack, the crowd's roar breaking into a gasp, no music, dust hissing across the floor.`,
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
