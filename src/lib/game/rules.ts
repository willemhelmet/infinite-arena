// Game rules and pacing shared by the server engine and the client.
//
// NEXT_PUBLIC_FAST_TIMERS=1 scales every timer down so the Playwright suite
// doesn't wait real seconds. It is NEXT_PUBLIC_ so the same flag reaches the
// client bundle (poll interval) and the server (countdown ticks); the e2e
// config sets it for the build step because NEXT_PUBLIC_* inlines at build.

const FAST =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_FAST_TIMERS === "1";
const SPEED = FAST ? 0.2 : 1;

export const MAX_ROUNDS = 5;
export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_TICK_MS = 1000 * SPEED;
export const POLL_INTERVAL_MS = 1000 * SPEED;

// How long an idle room survives in the store before it is forgotten.
export const ROOM_TTL_SECONDS = 3 * 60 * 60;

export const MIN_DAMAGE = 10;
export const DAMAGE_SPREAD = 15;

// Templated with both fighters' actions; {a} = the winning move, {b} = the
// losing move, {winner} = the winning fighter's name. Player-agnostic on
// purpose: the same text is broadcast to both players.
export const NARRATION_TEMPLATES = [
  "{a} — and it lands clean. {b} isn't fast enough to stop it. {winner} takes the exchange.",
  "They trade blows: {a}, answered by {b}. The crowd loses its mind as {winner} comes out ahead.",
  "{b} looks decisive — until {a} proves it was a trap. {winner} takes the round.",
  "The arena shakes as {a} collides with {b} midway. {winner} is the one still standing tall.",
  "{a} cuts straight through {b}. The narrator calls it for {winner}.",
];
