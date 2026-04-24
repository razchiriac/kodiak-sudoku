// RAZ-29 — Pure constants/types used by the rate limiter. Split out
// from `rate-limit.ts` so tests can import them without dragging in
// the DB client (which has `import "server-only"` at its top and
// therefore blows up in the Vitest runtime).

// A single bucket can declare multiple windows. See `HINT_LIMITS`
// below for the rationale on why the hint endpoint uses both a burst
// and a sustained cap.
export type RateLimitWindow = {
  windowMs: number;
  max: number;
  // Human-readable label so downstream surfaces can tell users which
  // limit they tripped. Returned alongside `retryAfterMs` in the
  // decision object so the UI can render "try again soon — limit is
  // 3 per minute".
  label: string;
};

export const HINT_BUCKET = "hint";

// Why two windows rather than one:
//   * A burst-only limit (e.g. 30/hour) catches slow scrapers but lets
//     a bot fire 29 requests in two seconds — effectively reconstructing
//     a third of the daily solution before the cap catches up.
//   * A sustained-only limit (e.g. 3/minute) forces a 20-second cooldown
//     but doesn't stop a patient scraper that paces requests at 2.9/min
//     for an hour.
//   * Together they close both gaps. The numbers below give a legit
//     human ~3 hints per minute (way more than anyone needs) and up to
//     30 per hour (enough for several daily puzzles on a painful day).
export const HINT_LIMITS: RateLimitWindow[] = [
  { windowMs: 60 * 1000, max: 3, label: "3 per minute" },
  { windowMs: 60 * 60 * 1000, max: 30, label: "30 per hour" },
];

// RAZ-61 — AI debrief generation bucket. Same shape as HINT_LIMITS but
// far stricter caps: each call hits a paid OpenAI endpoint, so we want
// a hard ceiling on cost per actor even if the UI somehow misbehaves
// and re-fires the action.
//
// Why these numbers:
//   * 5/minute lets a player retry a debrief once or twice (e.g. they
//     toggle the modal closed + reopen + the localStorage cache misses)
//     without ever hitting the limit on a real human session.
//   * 30/hour is generous (~one every two minutes) and keeps a
//     pathological hot-key scenario from running up a $X bill before
//     anyone notices.
// Both numbers are tunable; the rate-limit log gives us the data to
// retighten if we see abuse.
export const DEBRIEF_BUCKET = "ai-debrief";

export const DEBRIEF_LIMITS: RateLimitWindow[] = [
  { windowMs: 60 * 1000, max: 5, label: "5 per minute" },
  { windowMs: 60 * 60 * 1000, max: 30, label: "30 per hour" },
];
