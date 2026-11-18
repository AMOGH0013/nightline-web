"use client";

import { useState } from "react";
import { classLabel, formatWhen, passengerTitle } from "@/lib/format";

export type TicketData = {
  kind: string;
  passengerNumber: number | null;
  stowawayNumber: number | null;
  displayName: string;
  instagram: string | null;
  handlePublic?: boolean;
  handleVerified?: boolean;
  seatClass: string;
  carriage: number | null;
  seatLabel: string | null;
  role?: string | null;
  issuedAt: string;
  serial: string;
  qr: string;
  verifyUrl: string;
  anonymised?: boolean;
  permanentNumber?: number | null;
  followerRank?: number | null;
  originalEntitlement?: string | null;
  accommodation?: string | null;
  luxurySeat?: string | null;
  boardedAt?: string | null;
  boardingDay?: number | null;
  journeyDay?: number | null;
  shareUrl?: string;
  videoConsent?: boolean;
};

export function TicketView({ ticket, story = false }: { ticket: TicketData; story?: boolean }) {
  const [message, setMessage] = useState("");
  const title = passengerTitle(ticket.kind, ticket.passengerNumber, ticket.stowawayNumber, ticket.permanentNumber);

  async function share() {
    const url = ticket.shareUrl || ticket.verifyUrl;
    try {
      if (navigator.share) await navigator.share({ title: "NIGHTLINE passenger ticket", text: `${title} · ${ticket.displayName}`, url });
      else { await navigator.clipboard.writeText(url); setMessage("Ticket link copied."); }
    } catch { setMessage("Ticket sharing was cancelled."); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(ticket.shareUrl || ticket.verifyUrl); setMessage("Ticket link copied."); }
    catch { setMessage("Copy is unavailable in this browser."); }
  }

  async function download(vertical: boolean) {
    const canvas = document.createElement("canvas");
    canvas.width = vertical ? 1080 : 1400;
    canvas.height = vertical ? 1920 : 760;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#141613";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#c6a36a";
    ctx.lineWidth = 4;
    ctx.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
    ctx.fillStyle = "#c6a36a";
    ctx.font = "600 42px sans-serif";
    ctx.fillText("NIGHTLINE", 72, vertical ? 140 : 110);
    ctx.fillStyle = "#e7e1d4";
    ctx.font = "700 64px sans-serif";
    ctx.fillText(title, 72, vertical ? 280 : 220);
    ctx.font = "32px sans-serif";
    ctx.fillStyle = "#a39e93";
    const lines = [
      ticket.displayName,
      ticket.instagram ? `@${ticket.instagram}${ticket.handleVerified ? " · verified" : " · not verified"}` : "No public Instagram handle",
      `${classLabel(ticket.seatClass)} · ${ticket.carriage ? `Carriage ${ticket.carriage}` : "No carriage"} · ${ticket.seatLabel ?? "No seat"}`,
      ticket.role ? `Role ${ticket.role}` : "No special role",
      `Issued ${formatWhen(ticket.issuedAt)}`,
      `Original entitlement ${classLabel(ticket.originalEntitlement || ticket.seatClass)}`,
      `Current accommodation ${classLabel(ticket.accommodation || ticket.seatClass)}`,
      ticket.luxurySeat ? `Luxury seat ${ticket.luxurySeat}` : "No numbered Luxury seat",
      ticket.followerRank ? `Follower rank ${ticket.followerRank}` : "",
      ticket.boardingDay ? `Boarding Day ${ticket.boardingDay}` : "Boarding Day pending",
      ticket.journeyDay ? `Journey Day ${String(ticket.journeyDay).padStart(2, "0")}` : "PRE-BOARDING",
      "Destination UNKNOWN",
      ticket.serial,
    ];
    lines.forEach((line, index) => ctx.fillText(line, 72, (vertical ? 380 : 300) + index * 52));
    const image = new Image();
    image.src = ticket.qr;
    await image.decode();
    const size = vertical ? 360 : 220;
    ctx.drawImage(image, canvas.width - size - 80, canvas.height - size - 80, size, size);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = vertical ? `${ticket.serial}-story.png` : `${ticket.serial}.png`;
    link.click();
    setMessage(vertical ? "Story PNG downloaded." : "Ticket PNG downloaded.");
  }

  return (
    <div className={story ? "mx-auto max-w-[420px]" : ""}>
      <article data-ticket-class={(ticket.accommodation || ticket.seatClass).toLowerCase()} className={`ticket-metal panel rise overflow-hidden ${story ? "min-h-[740px]" : ""}`}>
        <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_180px]">
          <div>
            <p className="kicker">Passenger ticket</p>
            <h1 className="display mt-3 text-4xl text-ink sm:text-5xl">{title}</h1>
            <p className="ticket-name display mt-4 text-2xl">{ticket.displayName}</p>
            <p className="mt-2 text-sm text-muted">
              {ticket.instagram
                ? `@${ticket.instagram} · ${ticket.handleVerified ? "verified" : "not verified"}${ticket.handlePublic === false ? " · hidden from the manifest" : ""}`
                : "No Instagram handle on this ticket"}
            </p>
            {ticket.anonymised && (
              <p className="mt-3 text-sm text-danger">This account was anonymised. The seat remains occupied.</p>
            )}
            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <Item label="Original entitlement" value={classLabel(ticket.originalEntitlement || ticket.seatClass)} />
              <Item label="Current accommodation" value={classLabel(ticket.accommodation || ticket.seatClass)} />
              {ticket.followerRank ? <Item label="Follower rank" value={String(ticket.followerRank)} /> : null}
              {ticket.luxurySeat ? <Item label="Luxury seat" value={ticket.luxurySeat} /> : null}
              <Item label="Carriage" value={ticket.carriage ? String(ticket.carriage) : "—"} />
              <Item label="Seat" value={ticket.seatLabel ?? "—"} />
              <Item label="Boarding Day" value={ticket.boardingDay ? String(ticket.boardingDay).padStart(2, "0") : "Pending"} />
              <Item label="Journey Day" value={ticket.journeyDay ? String(ticket.journeyDay).padStart(2, "0") : "PRE-BOARDING"} />
              <Item label="Role" value={ticket.role ?? "None"} />
              <Item label="Issued" value={formatWhen(ticket.issuedAt)} />
              <Item label="Destination" value="UNKNOWN" />
            </dl>
            <p className="mono mt-6 text-amber">{ticket.serial}</p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ticket.qr} alt="Ticket verification code" width={160} height={160} />
            <a href={ticket.verifyUrl} className="text-xs text-muted underline">
              Public verification
            </a>
          </div>
        </div>
      </article>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn" type="button" onClick={() => download(false)}>Download PNG</button>
        <button className="btn secondary" type="button" onClick={() => download(true)}>Story PNG</button>
        <a className="btn secondary" href="/ticket/story">Story layout</a>
        <button className="btn secondary" type="button" onClick={share}>Share ticket</button>
        <button className="btn secondary" type="button" onClick={copyLink}>Copy ticket link</button>
      </div>
      {message && <p className="mt-3 text-sm text-olive">{message}</p>}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
