export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="container max-w-2xl py-10 prose prose-neutral dark:prose-invert">
      <h1>Privacy</h1>
      <p>
        We collect only what we need to run the game: your email (so we can sign you in), your
        chosen username, your saved games, your completion times, and basic anonymized event
        analytics (e.g. "puzzle started", "puzzle completed").
      </p>
      <p>
        We do not sell your data. We do not run third-party trackers. Your email is used only to
        send magic-link sign-in messages.
      </p>
      <p>
        You can request deletion of your account by signing in and emailing
        <a href="mailto:hello@example.com"> hello@example.com</a>; your profile, saved games, and
        completion history will be removed within 7 days.
      </p>
      <p>
        You can also use our dedicated <a href="/account-deletion">Account deletion</a> page for
        full request instructions and retention details.
      </p>
    </div>
  );
}
