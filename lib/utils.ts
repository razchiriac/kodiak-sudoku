import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn helper. Resolves Tailwind class conflicts so we can pass
// conditional classes from props without producing duplicates.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format milliseconds as MM:SS or H:MM:SS for the timer and result screen.
// We avoid Intl.DurationFormat because it's not in all browsers yet.
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

// Map difficulty bucket integers (1..4) to their display name. Matches the
// Drizzle enum in lib/db/schema.ts. We use a map (not an enum) per the
// project rules.
export const DIFFICULTY_LABEL: Record<number, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
  4: "Expert",
};

export const DIFFICULTY_SLUG: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
  expert: 4,
};
