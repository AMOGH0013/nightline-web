import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { readJourney, readOwnAchievements, readStamps } from "@/lib/content";
import { classLabel, formatWhen, passengerTitle } from "@/lib/format";
import { readOwned } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/board");
  const passenger = await readOwned(session.userId);
  if (!passenger) redirect("/register");
  const [journey, stamps, achievements] = await Promise.all([
    readJourney(session.userId),
    readStamps(session.userId),
    readOwnAchievements(session.userId),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-4">
        <div className="panel p-6">
          <p className="kicker">Passenger profile</p>
          <h1 className="display mt-2 text-4xl">
            {passengerTitle(passenger.kind, passenger.passenger_number, passenger.stowaway_number, passenger.permanent_number)}
          </h1>
          <p className="mt-3 text-xl">{passenger.display_name}</p>
          <p className="mt-2 text-sm text-muted">
            {classLabel(passenger.seat_class)} · {passenger.seat_label ?? "No seat"} · {passenger.role_label ?? "No special role"}
          </p>
          <p className="mt-2 text-sm text-muted">Registered {formatWhen(passenger.created_at)}</p>
          <p className="mt-4 text-sm">{passenger.bio || "No public biography yet."}</p>
          <p className="mt-3 text-xs text-olive">
            Instagram {passenger.instagram_handle ? `@${passenger.instagram_handle}` : "not provided"} · {passenger.handle_verified ? "verified" : "not verified"}
          </p>
          <Link className="btn mt-5" href="/ticket">Open ticket</Link>
        </div>
        <List title="Journey" empty="The boarding entry appears here after registration." rows={journey.map((item) => ({ id: item.id, title: item.title, body: item.body, when: item.occurred_at }))} />
        <List title="Achievements" empty="No achievements have been awarded." rows={achievements.map((item) => ({ id: item.key, title: item.label, body: item.description, when: item.awarded_at }))} />
        <List title="Stamps and discoveries" empty="No stamps have been added to this ticket." rows={stamps.map((item) => ({ id: item.id, title: item.label, body: item.note, when: item.stamped_at }))} />
      </section>
      <ProfileForm
        displayName={passenger.display_name}
        instagram={passenger.instagram_handle ?? ""}
        bio={passenger.bio ?? ""}
        handlePublic={passenger.handle_public}
        listed={passenger.is_listed}
        videoConsent={passenger.video_consent}
      />
    </div>
  );
}

function List({ title, empty, rows }: { title: string; empty: string; rows: { id: string; title: string; body: string | null; when: string }[] }) {
  return (
    <section className="panel p-6">
      <h2 className="display text-2xl">{title}</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">{empty}</p> : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <p>{row.title}</p>
              {row.body && <p className="text-sm text-muted">{row.body}</p>}
              <p className="mono text-xs text-olive">{formatWhen(row.when)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
