// Shared icon renderer used by every Next.js icon route in app/.
// Renders the same 3x3-grid logo we use in the header so install icons
// match the in-app branding. Returns React tree, not a Response, so
// each route can wrap it in ImageResponse with the right size.
//
// Two variants:
//   - "default": dark background, light dots. Matches the OG image
//     and looks correct on most launchers.
//   - "maskable": same content but inset into a 60% safe area inside
//     a solid background, so Android adaptive-icon cropping (circle,
//     squircle, etc.) never clips the grid.

type Variant = "default" | "maskable";

export function renderAppIcon({
  size,
  variant = "default",
}: {
  size: number;
  variant?: Variant;
}) {
  // Maskable safe area: Android adaptive icons crop to a centered
  // shape that covers ~80% of the canvas. We inset the visual to
  // 60% to be safe.
  const insetPct = variant === "maskable" ? 0.2 : 0.1;
  const inner = Math.round(size * (1 - insetPct * 2));
  const radius = Math.round(size * (variant === "maskable" ? 0 : 0.18));

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        // No outer rounding for maskable — the launcher applies its
        // own shape. Default rounding gives a friendly app-tile look.
        borderRadius: radius,
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gridTemplateRows: "repeat(3, 1fr)",
          borderRadius: Math.round(inner * 0.1),
          overflow: "hidden",
          border: `${Math.max(1, Math.round(size * 0.015))}px solid rgba(255,255,255,0.85)`,
        }}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            style={{
              background:
                i % 2 === 0 ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.08)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
