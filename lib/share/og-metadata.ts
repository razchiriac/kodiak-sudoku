import type { Metadata } from "next";

// RAZ-11 / share-result — helpers for building the dynamic OG image
// metadata a shared puzzle page advertises. Kept server-side (pure
// string manipulation, no React) so both /play/[puzzleId] and
// /daily[/..]/page.tsx can call it from their generateMetadata.
//
// A share URL looks like:
//   /play/123?shared=1&t=190000&m=0&h=0&d=3&mode=random
// or
//   /daily/2026-04-19?shared=1&t=190000&m=0&h=0&d=3&mode=daily&date=2026-04-19
//
// When the caller reads those params out of searchParams they hand
// them to `buildCompletionOgUrl` which emits the query string the OG
// route expects at /og/completion.

// Guards every numeric field: a bad query param shouldn't leak into
// the OG image and we don't want to render "NaN" on a social card.
function parseNonNeg(value: string | string[] | undefined): number | null {
  if (typeof value !== "string") return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// Extract share params from a page's searchParams. Returns null when
// the `shared=1` marker is missing so callers can skip the metadata
// customization entirely.
export function readShareParams(
  sp: Record<string, string | string[] | undefined>,
): {
  timeMs: number;
  mistakes: number;
  hints: number;
  difficulty: number;
  mode: "random" | "daily";
  date: string | undefined;
} | null {
  if (sp.shared !== "1") return null;
  const timeMs = parseNonNeg(sp.t);
  const mistakes = parseNonNeg(sp.m);
  const hints = parseNonNeg(sp.h);
  const difficulty = parseNonNeg(sp.d);
  if (timeMs === null || mistakes === null || hints === null || difficulty === null) {
    return null;
  }
  const mode = sp.mode === "daily" ? "daily" : "random";
  const date = typeof sp.date === "string" ? sp.date : undefined;
  return { timeMs, mistakes, hints, difficulty, mode, date };
}

// Build the absolute /og/completion URL the social crawler will fetch.
export function buildCompletionOgUrl(
  input: ReturnType<typeof readShareParams> & {},
  opts: { baseUrl: string },
): string {
  const q = new URLSearchParams({
    t: String(input.timeMs),
    m: String(input.mistakes),
    h: String(input.hints),
    d: String(input.difficulty),
    mode: input.mode,
  });
  if (input.date) q.set("date", input.date);
  const base = opts.baseUrl.replace(/\/$/, "");
  return `${base}/og/completion?${q.toString()}`;
}

// Build the `openGraph.images` / `twitter.images` Metadata payload for
// a shared puzzle page. Returns null when no share params are present
// so callers can spread it or bail out.
export function buildShareOgMetadata(
  sp: Record<string, string | string[] | undefined>,
  opts: { baseUrl: string },
): Pick<Metadata, "openGraph" | "twitter"> | null {
  const parsed = readShareParams(sp);
  if (!parsed) return null;
  const imageUrl = buildCompletionOgUrl(parsed, opts);
  // Minimal override: just the image. The parent metadata (title,
  // description) stays as-is so we don't have to duplicate the brand
  // copy in every generateMetadata.
  return {
    openGraph: {
      images: [{ url: imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      images: [imageUrl],
    },
  };
}
