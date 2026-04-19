import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t py-6 text-sm text-muted-foreground">
      <div className="container flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p>© {new Date().getFullYear()} Sudoku. Free to play.</p>
        <nav className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground"
          >
            Source
          </a>
        </nav>
      </div>
    </footer>
  );
}
