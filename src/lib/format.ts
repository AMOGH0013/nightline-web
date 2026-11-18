export function passengerTitle(kind: string, passengerNumber: number | null, stowawayNumber: number | null, permanentNumber?: number | null) {
  if (permanentNumber) return `Passenger ${permanentNumber}`;
  if (kind === "founding" && passengerNumber) {
    return `Passenger ${String(passengerNumber).padStart(3, "0")}`;
  }
  return `Stowaway ${String(stowawayNumber ?? 0).padStart(4, "0")}`;
}

export function classLabel(seatClass: string) {
  if (!seatClass) return "Standard";
  return seatClass.slice(0, 1).toUpperCase() + seatClass.slice(1);
}

export function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
