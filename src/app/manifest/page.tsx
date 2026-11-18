import { classLabel, passengerTitle } from "@/lib/format";
import { readManifest } from "@/lib/passengers";

export default async function ManifestPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; class?: string; carriage?: string; role?: string; day?: string }>;
}) {
  const params = await searchParams;
  const carriage = params.carriage ? Number(params.carriage) : undefined;
  const rows = await readManifest({
    q: params.q,
    seatClass: params.class,
    carriage: Number.isInteger(carriage) ? carriage : undefined,
    role: params.role,
    boardingDay: params.day && Number.isInteger(Number(params.day)) ? Number(params.day) : undefined,
  }).catch(() => null);

  return (
    <div>
      <p className="kicker">Public directory</p>
      <h1 className="display mt-2 text-5xl">Manifest</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Listed passengers only. Emails, account ids, verification codes and private profiles stay off this board.
      </p>
      <form className="mt-6 grid gap-3 sm:grid-cols-5">
        <input className="field" name="q" defaultValue={params.q ?? ""} placeholder="Name or handle" />
        <select className="field" name="class" defaultValue={params.class ?? ""}>
          <option value="">Any class</option>
          <option value="standard">Standard</option>
          <option value="luxury">Luxury</option>
          <option value="silver">Silver</option>
          <option value="bronze">Bronze</option>
          <option value="regular">Regular</option>
        </select>
        <input className="field" name="carriage" defaultValue={params.carriage ?? ""} placeholder="Carriage" />
        <input className="field" name="role" defaultValue={params.role ?? ""} placeholder="Role key" />
        <input className="field" name="day" defaultValue={params.day ?? ""} placeholder="Boarding Day" inputMode="numeric" />
        <button className="btn sm:col-span-5" type="submit">Filter</button>
      </form>
      {rows === null && <p className="mt-6 text-danger">The manifest could not be read. Check the database connection.</p>}
      {rows?.length === 0 && <p className="panel mt-6 p-6 text-muted">No listed passengers match.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto panel">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-muted mono">
              <tr>
                {["Passenger / rank", "Name", "Original entitlement", "Accommodation", "Luxury seat", "Carriage", "Seat", "Boarding Day", "Role", "Instagram", "Achievements"].map((heading) => (
                  <th key={heading} className="px-4 py-3 font-normal">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}-${row.permanent_number ?? row.passenger_number ?? row.stowaway_number}`} className="border-t border-line">
                  <td className="px-4 py-3">{passengerTitle(row.kind, row.passenger_number, row.stowaway_number, row.permanent_number)}{row.follower_rank ? <span className="block text-xs text-muted">Follower rank {row.follower_rank}</span> : null}</td>
                  <td className="px-4 py-3">{row.display_name}</td>
                  <td className="px-4 py-3">{classLabel(row.original_entitlement || row.seat_class)}</td>
                  <td className="px-4 py-3">{classLabel(row.current_accommodation)}</td>
                  <td className="px-4 py-3">{row.luxury_seat_code ?? "—"}</td>
                  <td className="px-4 py-3">{row.carriage ?? "—"}</td>
                  <td className="px-4 py-3">{row.seat_label ?? "—"}</td>
                  <td className="px-4 py-3">{row.boarding_day ? String(row.boarding_day).padStart(2, "0") : "—"}</td>
                  <td className="px-4 py-3">{row.special_role ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.instagram_handle ? `@${row.instagram_handle}${row.handle_verified ? " · verified" : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3">{row.achievements?.length ? row.achievements.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
