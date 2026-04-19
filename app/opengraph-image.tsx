import { ImageResponse } from "next/og";

// Default OG image for share previews. Uses Next.js's edge ImageResponse
// so we don't ship a static asset; the image regenerates if we ever
// change branding without a new deploy.
export const runtime = "edge";
export const alt = "Sudoku — the smoothest Sudoku you can play in a browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
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
                style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.1)" }}
              />
            ))}
          </div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>Sudoku</div>
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1, maxWidth: 900 }}>
          The smoothest Sudoku you can play in a browser.
        </div>
        <div style={{ fontSize: 28, marginTop: 24, opacity: 0.7 }}>
          Daily puzzles · Leaderboard · Free
        </div>
      </div>
    ),
    size,
  );
}
