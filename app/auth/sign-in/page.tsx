import { Suspense } from "react";
import { SignInForm } from "./form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="container max-w-sm py-10">
      <h1 className="mb-1 text-2xl font-bold">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Save your progress, join the daily leaderboard, and track your streak. We never email you
        anything except your magic link.
      </p>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
