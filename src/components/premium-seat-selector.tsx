"use client";

import { useState } from "react";

type PremiumSeat = { seat_code: string; price_inr: number | null; status: string; sale_approved: boolean };

export function PremiumSeatSelector({ seats }: { seats: PremiumSeat[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const available = (seat: PremiumSeat) => seat.status === "available" && seat.sale_approved && seat.price_inr !== null;
  const selection = seats.find((seat) => seat.seat_code === selected);
  return (
    <section className="panel p-5 sm:p-6">
      <p className="kicker">Pool A · L-001–L-099</p>
      <h2 className="display mt-2 text-3xl">Premium numbered seats</h2>
      <p className="mt-2 text-sm text-muted">Choose an available seat number. It changes your physical accommodation only; your passenger number and follower rank stay permanent.</p>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
        {seats.map((seat) => {
          const enabled = available(seat);
          return <button key={seat.seat_code} type="button" disabled={!enabled} onClick={() => setSelected(seat.seat_code)} aria-pressed={selected === seat.seat_code}
            className={`border px-2 py-3 text-left text-xs mono ${selected === seat.seat_code ? "border-amber bg-[#2a261c]" : "border-line"} ${enabled ? "hover:border-amber" : "cursor-not-allowed opacity-45"}`}>
            <span className="block">{seat.seat_code}</span><span className="mt-1 block text-muted">{enabled ? `₹${seat.price_inr}` : seat.price_inr === null ? "Blocked" : seat.status}</span>
          </button>;
        })}
      </div>
      {selection && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
        <p>Selected {selection.seat_code} · ₹{selection.price_inr}. This is not your passenger number.</p>
        <button type="button" className="btn" disabled>Continue · purchases disabled</button>
      </div>}
      <p className="mt-4 text-xs text-muted">L-010 is blocked until priced. L-200–L-400 are future upgrade inventory and are not on sale. All checkout remains disabled.</p>
    </section>
  );
}
