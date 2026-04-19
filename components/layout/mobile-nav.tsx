"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Mobile-only navigation. Desktop uses the inline links inside the
// Header. We render a hamburger trigger that opens a centered Dialog
// with the same three destinations. Keeping this as a Dialog (rather
// than installing a new Sheet primitive) keeps the bundle small and
// reuses the styles we already have.
//
// The Dialog auto-closes on link click thanks to the onClick handler;
// without that, Next.js's client-side navigation would change the URL
// while the modal stayed open.
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Open navigation menu"
          className="sm:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs sm:max-w-xs">
        <DialogTitle className="text-base">Navigate</DialogTitle>
        {/* Inlined links rather than a generic helper because the
            Next.js typed-routes plugin requires the href to be a
            literal at the call site (passing `href: string` through
            a prop drops the route type). Big py-3 tap targets so a
            thumb has plenty of room. */}
        <nav className="flex flex-col gap-1">
          <Link
            href="/play"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-accent"
          >
            Play
          </Link>
          <Link
            href="/daily"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-accent"
          >
            Daily
          </Link>
          <Link
            href="/leaderboard"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-accent"
          >
            Leaderboard
          </Link>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
