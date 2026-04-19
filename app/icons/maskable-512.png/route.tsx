import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/icon";

// Maskable variant: same logo, but with an extra safe-area inset so
// Android's adaptive-icon shape (circle, squircle, teardrop, etc.)
// can crop the canvas without clipping the visual. Manifest entry
// must declare purpose: "maskable".
export const runtime = "edge";

export function GET() {
  return new ImageResponse(renderAppIcon({ size: 512, variant: "maskable" }), {
    width: 512,
    height: 512,
  });
}
