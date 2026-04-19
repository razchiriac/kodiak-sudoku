import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/icon";

// Favicon. Next.js auto-injects a <link rel="icon"> referencing the
// emitted PNG. We pick 32x32 because it's the size browsers actually
// render in tabs; smaller and the 3x3 grid becomes mush.
export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(renderAppIcon({ size: 32 }), size);
}
