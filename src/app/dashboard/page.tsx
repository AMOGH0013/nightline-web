import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmissionForm } from "@/components/submission-form";
import { readAnnouncements, readCurrentEpisode, readDiscoveries, readLatestTransmission, readPolls, readTrain } from "@/lib/content";
import { formatWhen, passengerTitle } from "@/lib/format";
import { readOwned } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return (
      <section className="panel max-w-xl p-6">
        <h1 className="display text-4xl">Passenger terminal</h1>
        <p className="mt-3 text-muted">Sign in to see your place on the train. Nothing here is filled with invented operations data.</p>
        <Link className="btn mt-5" href="/board">Board</Link>
      </section>
    );
  }
  const passenger = await readOwned(session.userId);
  if (!passenger) redirect("/register");
  const [train, episode, transmission, polls, discoveries, announcements] = await Promise.all([
    readTrain(),
    readCurrentEpisode(),
    readLatestTransmission(),
    readPolls(session.userId),
    readDiscoveries(),
    readAnnouncements(),
  ]);
  const openPolls = polls.filter((poll) => poll.state === "open");

  return (
    <div className="space-y-6">
      <header>
        <p className="kicker">Signed in as {session.email ?? "passenger"}</p>
        <h1 className="display mt-2 text-5xl">Terminal</h1>
      </header>
      {announcements.map((item) => (
        <p key={item.id} className="border border-amber/40 bg-[#2a261c] px-4 py-3 text-sm">{item.title} — {item.body}</p>
      ))}
      <section className="grid gap-4 md:grid-cols-2">
        <article className="panel p-6">
          <p className="kicker">Train status</p>
          <h2 className="display mt-2 text-3xl">{train?.headline ?? "No status has been published."}</h2>
          <p className="mt-3 text-sm text-muted">{train?.detail || train?.state}</p>
          <p className="mono mt-3 text-xs text-olive">{formatWhen(train?.updated_at)}</p>
        </article>
        <article className="panel p-6">
          <p className="kicker">Your identity</p>
          <h2 className="display mt-2 text-3xl">{passengerTitle(passenger.kind, passenger.passenger_number, passenger.stowaway_number, passenger.permanent_number)}</h2>
          <p className="mt-3">{passenger.display_name}</p>
          <p className="mono text-amber">{passenger.serial}</p>
          <Link className="mt-4 inline-block text-sm underline" href="/ticket">Ticket</Link>
        </article>
        <article className="panel p-6">
          <p className="kicker">Current episode</p>
          {episode ? (
            <>
              <h2 className="display mt-2 text-3xl">{episode.number ? `Episode ${episode.number}` : episode.title}</h2>
              <p className="mt-3 text-sm text-muted">{episode.summary}</p>
            </>
          ) : <p className="mt-3 text-muted">No episode has been published.</p>}
        </article>
        <article className="panel p-6">
          <p className="kicker">Latest transmission</p>
          {transmission ? (
            <>
              <h2 className="display mt-2 text-3xl">{transmission.title}</h2>
              <p className="mt-3 text-sm text-muted">{transmission.body}</p>
            </>
          ) : <p className="mt-3 text-muted">No transmission has been published.</p>}
        </article>
      </section>
      <section className="panel p-6">
        <h2 className="display text-2xl">Journey progress</h2>
        <p className="mt-3 text-sm text-muted">
          You boarded on {formatWhen(passenger.issued_at)}. Further progress is recorded only when the creator adds a journey entry. There is no simulated mileage.
        </p>
        <Link className="mt-3 inline-block text-sm underline" href="/profile">Profile and history</Link>
      </section>
      <section className="panel p-6">
        <h2 className="display text-2xl">Open votes</h2>
        {openPolls.length === 0 ? <p className="mt-3 text-sm text-muted">No poll is open.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {openPolls.map((poll) => <li key={poll.id}>{poll.title}{poll.myVote ? " · vote recorded" : ""}</li>)}
          </ul>
        )}
        <Link className="btn secondary mt-4" href="/vote">Voting board</Link>
      </section>
      <section className="panel p-6">
        <h2 className="display text-2xl">Recent discoveries</h2>
        {discoveries.length === 0 ? <p className="mt-3 text-sm text-muted">No discoveries have been published.</p> : (
          <ul className="mt-3 space-y-3">
            {discoveries.slice(0, 4).map((item) => (
              <li key={item.id}><p>{item.title}</p><p className="text-sm text-muted">{item.body}</p></li>
            ))}
          </ul>
        )}
        <Link className="mt-4 inline-block text-sm underline" href="/archive">Archive</Link>
      </section>
      <SubmissionForm />
    </div>
  );
}
