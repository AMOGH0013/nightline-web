import { classLabel, formatWhen, passengerTitle } from "@/lib/format";
import { verifyCode } from "@/lib/passengers";

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ticket = await verifyCode(code).catch(() => null);
  if (!ticket) {
    return (
      <section className="panel max-w-xl p-6">
        <p className="kicker">Verification</p>
        <h1 className="display mt-2 text-4xl">No ticket</h1>
        <p className="mt-3 text-muted">This code does not match a public ticket, or the passenger has been hidden.</p>
      </section>
    );
  }
  return (
    <article className="panel max-w-xl p-6">
      <p className="kicker">Verified ticket</p>
      <h1 className="display mt-2 text-4xl">
        {passengerTitle(ticket.kind, ticket.passenger_number, ticket.stowaway_number, ticket.permanent_number)}
      </h1>
      <p className="mt-4 text-xl">{ticket.identity_public ? ticket.display_name : "Identity withheld"}</p>
      <p className="mt-2 text-sm text-muted">
        {ticket.instagram_handle
          ? `@${ticket.instagram_handle}${ticket.handle_verified ? " · verified" : " · not verified"}`
          : "No public Instagram handle"}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        {ticket.permanent_number !== null && <div><dt className="kicker">Passenger number</dt><dd>{ticket.permanent_number}</dd></div>}
        {ticket.original_entitlement && <div><dt className="kicker">Original entitlement</dt><dd>{classLabel(ticket.original_entitlement)}</dd></div>}
        <div><dt className="kicker">Current accommodation</dt><dd>{classLabel(ticket.current_accommodation)}</dd></div>
        {ticket.luxury_seat_code && <div><dt className="kicker">Luxury seat</dt><dd>{ticket.luxury_seat_code}</dd></div>}
        {ticket.follower_rank !== null && <div><dt className="kicker">Follower rank</dt><dd>{ticket.follower_rank}</dd></div>}
        <div><dt className="kicker">Carriage</dt><dd>{ticket.carriage ?? "—"}</dd></div>
        <div><dt className="kicker">Seat</dt><dd>{ticket.seat_label ?? "—"}</dd></div>
        <div><dt className="kicker">Role</dt><dd>{ticket.special_role ?? "None"}</dd></div>
        <div><dt className="kicker">Issued</dt><dd>{formatWhen(ticket.issued_at)}</dd></div>
        <div><dt className="kicker">Destination</dt><dd>UNKNOWN</dd></div>
      </dl>
      <p className="mono mt-6 text-amber">{ticket.serial}</p>
      {!ticket.identity_public && (
        <p className="mt-4 text-sm text-muted">The ticket is genuine. The passenger chose not to list their name.</p>
      )}
    </article>
  );
}
