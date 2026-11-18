"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Seat = { seat_code: string; seat_number: number; pool: string; price_inr: number | null; sale_approved: boolean; status: string; assignment_type: string | null; permanent_number: number | null; instagram_handle: string | null };

export function LuxuryInventoryPanel({ seats }: { seats: Seat[] }) {
  const router = useRouter();
  const [seatCode, setSeatCode] = useState("L-010");
  const [price, setPrice] = useState("");
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pools = { premium: seats.filter((seat) => seat.pool === "premium").length, follower: seats.filter((seat) => seat.pool === "follower_entitlement").length, future: seats.filter((seat) => seat.pool === "future_upgrade").length };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "luxury-seat-config", seatCode: seatCode.toUpperCase(), priceInr: price ? Number(price) : null, saleApproved: approved }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Seat configuration was not saved.");
      setMessage(`${seatCode.toUpperCase()} updated. Payments remain disabled until separately approved.`);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Seat configuration was not saved."); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-4 p-6">
      <div><p className="kicker">400 physical Luxury seats</p><h2 className="display mt-2 text-3xl">Numbered inventory</h2></div>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <p className="border border-line p-3">Pool A · {pools.premium} premium numbered seats · L-001–L-099</p>
        <p className="border border-line p-3">Pool B · {pools.follower} first-follower entitlements · L-100–L-199</p>
        <p className="border border-line p-3">Pool C · {pools.future} future upgrades · L-200–L-400</p>
      </div>
      <p className="text-xs text-muted">Inventory total: {seats.length}. L-010 has no configured price. Pool C is unavailable until the creator configures and approves each seat. Payments are not active.</p>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="text-sm">Seat number<input className="field mt-1" value={seatCode} onChange={(event) => setSeatCode(event.target.value)} pattern="L-(00[1-9]|0[1-9][0-9]|[1-3][0-9]{2}|400)" required /></label>
        <label className="text-sm">Price (INR)<input className="field mt-1" type="number" min={1} step={1} value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Not configured" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Approve sale</label>
        <button className="btn" disabled={busy} type="submit">Save seat</button>
      </form>
      {message && <p className="text-sm text-olive" role="status">{message}</p>}
      <div className="max-h-96 overflow-auto border border-line">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="sticky top-0 bg-soot text-muted"><tr>{["Seat", "Pool", "Price", "Approved", "Status", "Passenger", "Username"].map((x) => <th key={x} className="px-3 py-2 font-normal">{x}</th>)}</tr></thead>
          <tbody>{seats.map((seat) => <tr key={seat.seat_code} className="border-t border-line">
            <td className="px-3 py-2 mono">{seat.seat_code}</td><td className="px-3 py-2">{seat.pool.replaceAll("_", " ")}</td>
            <td className="px-3 py-2">{seat.price_inr === null ? "Not configured" : `₹${seat.price_inr}`}</td><td className="px-3 py-2">{seat.sale_approved ? "Yes" : "No"}</td><td className="px-3 py-2">{seat.status}</td>
            <td className="px-3 py-2">{seat.permanent_number ?? "—"}</td><td className="px-3 py-2">{seat.instagram_handle ? `@${seat.instagram_handle}` : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
