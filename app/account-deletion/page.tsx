import Link from "next/link";

export const metadata = { title: "Account deletion" };

export default function AccountDeletionPage() {
  return (
    <div className="container max-w-2xl py-10 prose prose-neutral dark:prose-invert">
      <h1>Account deletion</h1>
      <p>
        If you want to delete your Sudoku account and associated data, email{" "}
        <a href="mailto:hello@example.com">hello@example.com</a> from the address used to sign in.
      </p>
      <h2>How to request deletion</h2>
      <ol>
        <li>Sign in to your account once, so we can verify recent account ownership.</li>
        <li>
          Send an email to <a href="mailto:hello@example.com">hello@example.com</a> with subject
          line <strong>Delete my Sudoku account</strong>.
        </li>
        <li>We confirm and process your request within 7 days.</li>
      </ol>
      <h2>What we delete</h2>
      <ul>
        <li>Profile and username.</li>
        <li>Saved games and in-progress boards stored on our servers.</li>
        <li>Completion history and leaderboard-linked records tied to your account.</li>
      </ul>
      <h2>What may be retained</h2>
      <ul>
        <li>Operational logs and security records for up to 30 days.</li>
        <li>Aggregate analytics that are no longer linked to your identity.</li>
      </ul>
      <p>
        If you use the app without an account, you can clear local device data by uninstalling the
        app or clearing app storage in Android settings.
      </p>
      <p>
        For more details, see our <Link href="/privacy">Privacy page</Link>.
      </p>
    </div>
  );
}
