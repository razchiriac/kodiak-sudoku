import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { AuthMenu } from "./auth-menu";
import { MobileNav } from "./mobile-nav";

// Site header. Server Component — the interactive bits (theme toggle,
// auth menu, mobile nav) are tiny client islands.
export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 grid-cols-3 grid-rows-3 overflow-hidden rounded border">
            {/* Tiny logo: 3x3 grid of dots evoking a sudoku box. */}
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className={i % 2 === 0 ? "bg-primary/80" : "bg-primary/10"} />
            ))}
          </span>
          <span>Sudoku</span>
        </Link>
        <nav className="hidden items-center gap-4 text-sm sm:flex">
          <Link href="/play" className="text-muted-foreground hover:text-foreground">
            Play
          </Link>
          <Link href="/daily" className="text-muted-foreground hover:text-foreground">
            Daily
          </Link>
          <Link href="/leaderboard" className="text-muted-foreground hover:text-foreground">
            Leaderboard
          </Link>
          <Link href="/friends" className="text-muted-foreground hover:text-foreground">
            Friends
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <AuthMenu />
          {/* Mobile-only hamburger; hidden via Tailwind on sm+ where the
              inline nav above is visible instead. */}
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
