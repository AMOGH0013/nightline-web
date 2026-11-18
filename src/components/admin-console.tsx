"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { passengerTitle } from "@/lib/format";
import { FollowerImportPanel } from "@/components/follower-import-panel";
import { LuxuryInventoryPanel } from "@/components/luxury-inventory-panel";
import { JourneySettingsPanel } from "@/components/journey-settings-panel";

type Passenger = {
  user_id: string;
  email: string | null;
  display_name: string;
  kind: string;
  passenger_number: number | null;
  permanent_number: number | null;
  follower_rank: number | null;
  original_entitlement: string | null;
  luxury_seat_code: string | null;
  stowaway_number: number | null;
  seat_class: string;
  carriage: number | null;
  seat_label: string | null;
  special_role: string | null;
  moderation: string;
  is_listed: boolean;
  instagram_handle: string | null;
  handle_verified: boolean;
  anonymised_at: string | null;
  messaging_claimed: boolean;
};

type Role = { key: string; label: string; enabled: boolean; note: string | null };
type Submission = { id: string; display_name: string; body: string; status: string; created_at: string };
type Poll = { id: string; title: string; closes_at: string; published: boolean };
type FollowerImport = { id: string; file_names: string[]; status: string; total_records: number; unique_records: number; duplicate_records: number; malformed_records: number; missing_timestamps: number; late_historical_records: number; summary: Record<string, unknown>; created_at: string; confirmed_at: string | null };
type LuxurySeat = { seat_code: string; seat_number: number; pool: string; price_inr: number | null; sale_approved: boolean; status: string; assignment_type: string | null; permanent_number: number | null; instagram_handle: string | null };

export function AdminConsole(props: {
  query: string;
  passengers: Passenger[];
  summary: {
    importedFollowers: number;
    luxuryEntitlements: number;
    highestPassengerNumber: number | null;
  };
  roles: Role[];
  submissions: Submission[];
  polls: Poll[];
  followerImports: FollowerImport[];
  luxurySeats: LuxurySeat[];
  journeySettings: { launch_at: string | null; timezone: string };
  journeyDay: number | null;
  passengerOperations: { totalPassengers: number; importedFollowers: number; claimedFollowers: number; unclaimedFollowers: number; luxuryOccupied: number; luxuryAvailable: number; importsRequiringReview: number; integrationStatus: string };
  claimFailures: { username:string|null; status:string; occurred_at:string }[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function send(body: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Saved." : payload.message ?? "The console rejected that.");
    setPending(false);
    if (response.ok) router.refresh();
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="kicker">Conductor’s desk</p>
        <h1 className="display mt-2 text-5xl">Admin</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          {props.summary.importedFollowers} imported followers · {props.summary.luxuryEntitlements} first-100 Luxury entitlements ·
          highest passenger number {props.summary.highestPassengerNumber ?? "not assigned"}.
        </p>
      </header>
      <FollowerImportPanel history={props.followerImports} />
      <section aria-label="Passenger operations" className="panel p-6">
        <p className="kicker">Passenger operations</p><h2 className="display mt-2 text-2xl">Claim and inventory status</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {Object.entries({ "Total passengers": props.passengerOperations.totalPassengers, "Imported followers": props.passengerOperations.importedFollowers, "Claimed by Manychat": props.passengerOperations.claimedFollowers, "Awaiting claim": props.passengerOperations.unclaimedFollowers, "Luxury seats occupied": props.passengerOperations.luxuryOccupied, "Premium seats available": props.passengerOperations.luxuryAvailable, "Imports to review": props.passengerOperations.importsRequiringReview, "Messaging integration": props.passengerOperations.integrationStatus }).map(([label, value]) => <div key={label}><dt className="kicker">{label}</dt><dd className="mt-1">{value}</dd></div>)}
        </dl>
        <p className="mt-4 text-xs text-muted">A configured secret only enables the authenticated endpoint. Real Manychat delivery remains unverified until tested in the connected account.</p>
        <h3 className="display mt-5 text-xl">Recent claim issues</h3>
        {props.claimFailures.length === 0 ? <p className="mt-2 text-sm text-muted">No failed claim attempts in the last 30 days.</p> : <ul className="mt-2 space-y-1 text-xs text-muted">{props.claimFailures.map((entry,index)=><li key={`${entry.occurred_at}-${index}`}>{entry.occurred_at} · {entry.status} · @{entry.username ?? "unknown"}</li>)}</ul>}
      </section>
      <JourneySettingsPanel launchAt={props.journeySettings.launch_at} timezone={props.journeySettings.timezone} currentDay={props.journeyDay} />
      <LuxuryInventoryPanel seats={props.luxurySeats} />
      <section className="panel p-6">
        <p className="kicker">Video identity export</p>
        <h2 className="display mt-2 text-2xl">Consent-approved passengers</h2>
        <p className="mt-2 text-sm text-muted">Only passengers with active video consent are included. The export has no email, account id, or verification code.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a className="btn secondary" href="/api/admin/video-export?format=csv">Download CSV</a>
          <a className="btn secondary" href="/api/admin/video-export?format=json">Download Blender JSON</a>
        </div>
      </section>
      {message && <p className="text-sm text-olive">{message}</p>}

      <form className="flex flex-wrap gap-3" action="/admin">
        <input className="field max-w-md" name="q" defaultValue={props.query} placeholder="Name, email, number, seat" />
        <button className="btn" type="submit">Search</button>
      </form>

      <div className="overflow-x-auto panel">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-muted mono">
            <tr>
              <th className="px-3 py-3 font-normal">Passenger</th>
              <th className="px-3 py-3 font-normal">Seat</th>
              <th className="px-3 py-3 font-normal">Role</th>
              <th className="px-3 py-3 font-normal">Listing</th>
            </tr>
          </thead>
          <tbody>
            {props.passengers.length === 0 && (
              <tr><td className="px-3 py-4 text-muted" colSpan={4}>No passengers match.</td></tr>
            )}
            {props.passengers.map((passenger) => (
              <tr key={passenger.user_id} className="border-t border-line">
                <td className="px-3 py-3">
                  <p>{passengerTitle(passenger.kind, passenger.passenger_number, passenger.stowaway_number, passenger.permanent_number)}</p>
                  {passenger.follower_rank ? <p className="text-xs text-muted">Follower rank {passenger.follower_rank} · {passenger.original_entitlement} original entitlement · {passenger.luxury_seat_code ?? "no Luxury seat"}</p> : null}
                  <p>{passenger.display_name}</p>
                  <p className="text-xs text-muted">{passenger.email ?? "No email on the local record"}{passenger.follower_rank ? ` · ${passenger.messaging_claimed ? "claimed via Manychat" : "awaiting claim"}` : ""}</p>
                </td>
                <td className="px-3 py-3">{passenger.seat_label ?? "—"} · {passenger.seat_class}</td>
                <td className="px-3 py-3">{passenger.special_role ?? "None"}</td>
                <td className="px-3 py-3">
                  {passenger.moderation} · {passenger.is_listed ? "listed" : "private"}
                  {passenger.handle_verified ? " · handle verified" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <PassengerAction title="Assign role" pending={pending} onSubmit={(data) => send({
          action: "assign-role",
          userId: data.get("userId"),
          role: String(data.get("role") || "") || null,
        })}>
          <UserField />
          <input className="field" name="role" placeholder="Role key, blank to clear" />
        </PassengerAction>
        <PassengerAction title="Moderation" pending={pending} onSubmit={(data) => send({
          action: "moderation",
          userId: data.get("userId"),
          moderation: data.get("moderation"),
        })}>
          <UserField />
          <select className="field" name="moderation" defaultValue="ok">
            <option value="ok">ok</option>
            <option value="flagged">flagged</option>
            <option value="hidden">hidden</option>
          </select>
        </PassengerAction>
        <PassengerAction title="Manifest listing" pending={pending} onSubmit={(data) => send({
          action: "listed",
          userId: data.get("userId"),
          listed: data.get("listed") === "true",
        })}>
          <UserField />
          <select className="field" name="listed" defaultValue="true">
            <option value="true">Listed</option>
            <option value="false">Private</option>
          </select>
        </PassengerAction>
        <PassengerAction title="Verify Instagram" pending={pending} onSubmit={(data) => send({
          action: "verify-handle",
          userId: data.get("userId"),
          verified: data.get("verified") === "true",
        })}>
          <UserField />
          <select className="field" name="verified" defaultValue="true">
            <option value="true">Mark verified</option>
            <option value="false">Clear verification</option>
          </select>
        </PassengerAction>
        <PassengerAction title="Award achievement" pending={pending} onSubmit={(data) => send({
          action: "achievement",
          userId: data.get("userId"),
          key: data.get("key"),
          label: data.get("label"),
        })}>
          <UserField />
          <input className="field" name="key" placeholder="key" required />
          <input className="field" name="label" placeholder="Label" required />
        </PassengerAction>
        <PassengerAction title="Add stamp" pending={pending} onSubmit={(data) => send({
          action: "stamp",
          userId: data.get("userId"),
          label: data.get("label"),
          note: data.get("note") ?? "",
        })}>
          <UserField />
          <input className="field" name="label" placeholder="Stamp" required />
          <input className="field" name="note" placeholder="Note" />
        </PassengerAction>
      </section>

      <section className="panel p-6">
        <h2 className="display text-2xl">Roles</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {props.roles.map((role) => (
            <li key={role.key} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <span>
                {role.label} · {role.enabled ? "enabled" : "disabled"}
                <span className="block text-muted">{role.note}</span>
              </span>
              <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "role-enabled", key: role.key, enabled: !role.enabled })}>
                {role.enabled ? "Disable" : "Enable"}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-3">
          <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "registration", open: true })}>Open registration</button>
          <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "registration", open: false })}>Close registration</button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TextAction title="Publish a poll" pending={pending} onSubmit={(data) => send({
          action: "poll",
          title: data.get("title"),
          story: data.get("story"),
          options: String(data.get("options") ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
          opensAt: new Date(String(data.get("opensAt"))).toISOString(),
          closesAt: new Date(String(data.get("closesAt"))).toISOString(),
          showResults: data.get("showResults"),
        })}>
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-24" name="story" placeholder="Story" required />
          <textarea className="field min-h-24" name="options" placeholder="One option per line" required />
          <input className="field" name="opensAt" type="datetime-local" required />
          <input className="field" name="closesAt" type="datetime-local" required />
          <select className="field" name="showResults" defaultValue="after_close">
            <option value="live">Show results live</option>
            <option value="after_close">Show results after close</option>
            <option value="hidden">Hide results</option>
          </select>
        </TextAction>
        <TextAction title="Train status" pending={pending} onSubmit={(data) => send({
          action: "train",
          state: data.get("state"),
          headline: data.get("headline"),
          detail: data.get("detail"),
        })}>
          <input className="field" name="state" placeholder="State" required />
          <input className="field" name="headline" placeholder="Headline" required />
          <textarea className="field min-h-24" name="detail" placeholder="Detail" />
        </TextAction>
        <TextAction title="Transmission" pending={pending} onSubmit={(data) => send({ action: "transmission", title: data.get("title"), body: data.get("body") })}>
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-28" name="body" placeholder="Body" required />
        </TextAction>
        <TextAction title="Episode" pending={pending} onSubmit={(data) => send({
          action: "episode",
          number: Number(data.get("number")),
          title: data.get("title"),
          summary: data.get("summary"),
        })}>
          <input className="field" name="number" type="number" min={1} placeholder="Number" required />
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-24" name="summary" placeholder="Summary" required />
        </TextAction>
        <TextAction title="Archive entry" pending={pending} onSubmit={(data) => send({
          action: "archive",
          kind: data.get("kind"),
          title: data.get("title"),
          body: data.get("body"),
          occurredOn: data.get("occurredOn") || undefined,
        })}>
          <select className="field" name="kind" defaultValue="event">
            {["episode", "location", "decision", "vote_outcome", "event", "transmission", "discovery"].map((kind) => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select>
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-24" name="body" placeholder="Body" required />
          <input className="field" name="occurredOn" type="date" />
        </TextAction>
        <TextAction title="Discovery" pending={pending} onSubmit={(data) => send({ action: "discovery", title: data.get("title"), body: data.get("body") })}>
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-24" name="body" placeholder="Body" required />
        </TextAction>
        <TextAction title="Announcement" pending={pending} onSubmit={(data) => send({
          action: "announcement",
          title: data.get("title"),
          body: data.get("body"),
          active: data.get("active") === "on",
        })}>
          <input className="field" name="title" placeholder="Title" required />
          <textarea className="field min-h-24" name="body" placeholder="Body" required />
          <label className="flex gap-2 text-sm"><input name="active" type="checkbox" defaultChecked /> Active</label>
        </TextAction>
      </section>

      <section className="panel p-6">
        <h2 className="display text-2xl">Polls</h2>
        {props.polls.length === 0 && <p className="mt-3 text-sm text-muted">No polls yet.</p>}
        <ul className="mt-3 space-y-2 text-sm">
          {props.polls.map((poll) => (
            <li key={poll.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2">
              <span>{poll.title}</span>
              <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "archive-poll", pollId: poll.id })}>
                Record result in the archive
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel p-6">
        <h2 className="display text-2xl">Submissions</h2>
        {props.submissions.length === 0 && <p className="mt-3 text-sm text-muted">No notes waiting.</p>}
        <ul className="mt-3 space-y-4">
          {props.submissions.map((item) => (
            <li key={item.id} className="border-t border-line pt-3 text-sm">
              <p className="text-muted">{item.display_name} · {item.status}</p>
              <p className="mt-1 whitespace-pre-wrap">{item.body}</p>
              <div className="mt-2 flex gap-2">
                <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "review", id: item.id, status: "reviewed" })}>Mark reviewed</button>
                <button className="btn secondary" disabled={pending} type="button" onClick={() => send({ action: "review", id: item.id, status: "archived" })}>Archive</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function UserField() {
  return <input className="field mono" name="userId" placeholder="Account id" required />;
}

function PassengerAction({
  title,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  pending: boolean;
  onSubmit: (data: FormData) => void;
  children: React.ReactNode;
}) {
  return (
    <form
      className="panel space-y-3 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <h2 className="display text-2xl">{title}</h2>
      {children}
      <button className="btn" disabled={pending} type="submit">Apply</button>
    </form>
  );
}

function TextAction({
  title,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  pending: boolean;
  onSubmit: (data: FormData) => void;
  children: React.ReactNode;
}) {
  return <PassengerAction title={title} pending={pending} onSubmit={onSubmit}>{children}</PassengerAction>;
}
