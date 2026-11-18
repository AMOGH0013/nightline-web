import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { TicketView } from "@/components/ticket-view";
import { getRuntime } from "@/lib/env";
import { readOwned } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function StoryTicketPage() {
  const session = await getSession();
  if (!session) redirect("/board");
  const passenger = await readOwned(session.userId);
  if (!passenger) redirect("/register");
  const verifyUrl = `${getRuntime().siteUrl}/verify/${passenger.verification_code}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, color: { dark: "#141613", light: "#e7e1d4" } });
  return (
    <TicketView
      story
      ticket={{
        kind: passenger.kind,
        passengerNumber: passenger.passenger_number,
        stowawayNumber: passenger.stowaway_number,
        displayName: passenger.display_name,
        instagram: passenger.handle_public ? passenger.instagram_handle : null,
        handlePublic: passenger.handle_public,
        handleVerified: passenger.handle_verified,
        seatClass: passenger.seat_class,
        carriage: passenger.carriage,
        seatLabel: passenger.seat_label,
        role: passenger.role_label,
        issuedAt: passenger.issued_at,
        serial: passenger.serial,
        qr,
        verifyUrl,
        anonymised: Boolean(passenger.anonymised_at),
      }}
    />
  );
}
