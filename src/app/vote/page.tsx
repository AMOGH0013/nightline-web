import { VotePanel } from "@/components/vote-panel";
import { readPolls } from "@/lib/content";
import { getSession } from "@/lib/session";

export default async function VotePage() {
  const session = await getSession();
  const polls = await readPolls(session?.userId ?? null).catch(() => null);
  return (
    <div>
      <p className="kicker">One passenger, one vote</p>
      <h1 className="display mt-2 text-5xl">Decisions</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Paid class does not add weight. A second vote from the same account is rejected. Closed results can be written into the archive by an administrator.
      </p>
      <div className="mt-6">
        {polls === null ? <p className="text-danger">The voting board is unavailable.</p> : <VotePanel polls={polls} signedIn={Boolean(session)} />}
      </div>
    </div>
  );
}
