import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/play`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/daily`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/leaderboard`, changeFrequency: "daily", priority: 0.8 },
  ];
}
