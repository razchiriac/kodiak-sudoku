import { ImageResponse } from "next/og";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";

// RAZ-11 / share-result — dynamic OG image for shared completions.
// Called via `/og/completion?t=<ms>&m=<mistakes>&h=<hints>&d=<bucket>&mode=random|daily&date=...`.
// Query params are short (t/m/h/d) because they end up in the share
// URL the user copies to the clipboard, and shorter URLs are friendlier
// on SMS / twitter.
//
// Edge runtime matches the other OG route (app/opengraph-image.tsx) so
// the response is cached at the edge and doesn't spin up a lambda per
// hit. We don't gate this on the `share-result` flag: the flag only
// controls whether the share BUTTON renders. The OG endpoint has to
// keep working for already-shared links even if the flag is later
// flipped off.

export const runtime = "edge";

const SIZE = { width: 1200, height: 630 };

function clampInt(value: string | null, min: number, max: number): number {
  if (!value) return min;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  // All numeric params are validated: an attacker putting gigantic
  // integers here would slow down the renderer for no gain. Difficulty
  // is clamped to 1..4 to match the enum in lib/utils.
  const timeMs = clampInt(sp.get("t"), 0, 24 * 60 * 60 * 1000);
  const mistakes = clampInt(sp.get("m"), 0, 999);
  const hints = clampInt(sp.get("h"), 0, 81);
  const difficulty = clampInt(sp.get("d"), 1, 4);
  const mode = sp.get("mode") === "daily" ? "daily" : "random";
  const date = sp.get("date") ?? "";

  const headline =
    mode === "daily" && date
      ? `Daily · ${DIFFICULTY_LABEL[difficulty]} · ${date}`
      : `${DIFFICULTY_LABEL[difficulty]} puzzle`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          color: "white",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {/* Top row: logo + wordmark. Mirrors app/opengraph-image.tsx
            so the two cards read as part of the same brand system. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
          <div
            style={{
              width: 48,
              height: 48,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridTemplateRows: "repeat(3, 1fr)",
              borderRadius: 8,
              border: "2px solid white",
              overflow: "hidden",
            }}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                style={{
                  background:
                    i % 2 === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.1)",
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>Sudoku</div>
        </div>

        {/* Headline: mode + difficulty + optional date. */}
        <div
          style={{
            fontSize: 40,
            fontWeight: 500,
            opacity: 0.75,
            marginBottom: 24,
          }}
        >
          {headline}
        </div>

        {/* Big time. The one number we want the reader's eye to land on. */}
        <div
          style={{
            fontSize: 180,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily: "ui-monospace, Menlo, monospace",
            letterSpacing: -4,
          }}
        >
          {formatTime(timeMs)}
        </div>

        {/* Bottom stat strip: mistakes + hints. */}
        <div
          style={{
            display: "flex",
            gap: 48,
            marginTop: 48,
            fontSize: 32,
            opacity: 0.85,
          }}
        >
          <span>🎯 {mistakes} mistake{mistakes === 1 ? "" : "s"}</span>
          <span>💡 {hints} hint{hints === 1 ? "" : "s"}</span>
        </div>
      </div>
    ),
    SIZE,
  );
}
