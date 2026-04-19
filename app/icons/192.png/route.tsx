import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/icon";

// 192x192 PWA icon for Android home screen. Referenced from
// app/manifest.ts. Served at /icons/192.png.
//
// We use a route handler under app/icons/ rather than Next.js's
// auto-icon convention (app/icon0.tsx etc.) because the auto path
// is hashed at build time, and the manifest needs a stable URL
// Chrome can fetch directly.
export const runtime = "edge";

export function GET() {
  return new ImageResponse(renderAppIcon({ size: 192 }), {
    width: 192,
    height: 192,
  });
}
