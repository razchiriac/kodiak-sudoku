import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/icon";

// 512x512 PWA icon. Used by Android for the install banner and the
// splash screen drawn while the standalone app boots.
export const runtime = "edge";

export function GET() {
  return new ImageResponse(renderAppIcon({ size: 512 }), {
    width: 512,
    height: 512,
  });
}
