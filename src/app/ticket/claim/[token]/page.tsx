import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { TicketView } from "@/components/ticket-view";
import { getRuntime } from "@/lib/env";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ClaimedTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [ticket] = await query<{
    passenger_number: number | null; permanent_number: number | null; follower_rank: number | null;
    original_entitlement: string | null; seat_class: string; seat: string | null; display_name: string;
    instagram_handle: string | null; handle_verified: boolean; issued_at: string; serial: string; verification_code: string;
    carriage: number | null; seat_label: string | null; boarded_on_journey_day: number | null;
  }>(`select p.passenger_number,p.permanent_number,p.follower_rank,p.original_entitlement,p.seat_class,
      ls.seat_code as seat,pr.display_name,pr.instagram_handle,pr.handle_verified,p.issued_at::text,t.serial,t.verification_code,
      p.carriage,p.seat_label,p.boarded_on_journey_day
    from public.passenger_ticket_access a join public.passengers p on p.id=a.passenger_id
    join public.profiles pr on pr.id=p.user_id join public.tickets t on t.passenger_id=p.id
    left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
    where a.token_hash=$1 and a.revoked_at is null and pr.anonymised_at is null`, [tokenHash]);
  if (!ticket) notFound();
  const verifyUrl = `${getRuntime().siteUrl.replace(/\/$/, "")}/verify/${ticket.verification_code}`;
  const shareUrl = `${getRuntime().siteUrl.replace(/\/$/, "")}/ticket/claim/${token}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, color: { dark: "#141613", light: "#e7e1d4" } });
  return <TicketView ticket={{
    kind: "founding", passengerNumber: ticket.passenger_number, stowawayNumber: null,
    permanentNumber: ticket.permanent_number, followerRank: ticket.follower_rank,
    originalEntitlement: ticket.original_entitlement, accommodation: ticket.seat_class, seatClass: ticket.seat_class,
    luxurySeat: ticket.seat, displayName: ticket.display_name, instagram: ticket.instagram_handle,
    handleVerified: ticket.handle_verified, handlePublic: false, issuedAt: ticket.issued_at, serial: ticket.serial,
    qr, verifyUrl, shareUrl, carriage: ticket.carriage, seatLabel: ticket.seat_label,
    boardingDay: ticket.boarded_on_journey_day,
  }} />;
}
