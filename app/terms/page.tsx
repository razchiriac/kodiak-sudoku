export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <div className="container max-w-2xl py-10 prose prose-neutral dark:prose-invert">
      <h1>Terms</h1>
      <p>
        This is a free Sudoku web app provided as-is, without warranty of any kind. Don't try to
        cheat the leaderboard; it's for fun.
      </p>
      <p>
        We may remove leaderboard entries or accounts that submit clearly fraudulent times. We
        reserve the right to change these terms; significant changes will be announced on the
        landing page.
      </p>
    </div>
  );
}
