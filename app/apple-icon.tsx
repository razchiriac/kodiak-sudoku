import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/icon";

// iOS home-screen icon. Next.js auto-injects a
// <link rel="apple-touch-icon"> for this. 180x180 is Apple's
// canonical size — anything smaller gets upscaled and looks fuzzy.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(renderAppIcon({ size: 180 }), size);
}
