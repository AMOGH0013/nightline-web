"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function JourneySettingsPanel({ launchAt, timezone, currentDay }: { launchAt: string | null; timezone: string; currentDay: number | null }) {
  const router = useRouter();
  const [zone, setZone] = useState(timezone);
  const [launch, setLaunch] = useState(launchAt ? dateTimeInZone(launchAt, timezone) : "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "journey-settings", launchAt: launch ? dateTimeToZone(launch, zone) : null, timezone: zone }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Journey settings were not saved.");
      setMessage("Journey clock saved. The global day and passenger boarding day use this timezone.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Journey settings were not saved."); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel space-y-4 p-6">
      <div><p className="kicker">Journey clock</p><h2 className="display mt-2 text-3xl">{currentDay ? `Day ${String(currentDay).padStart(2, "0")}` : "PRE-BOARDING"}</h2><p className="mt-2 text-sm text-muted">No launch date is assumed. Set the official timestamp when it is decided.</p></div>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <label className="text-sm">Launch timestamp<input className="field mt-1" type="datetime-local" value={launch} onChange={(event) => setLaunch(event.target.value)} /></label>
        <label className="text-sm">Timezone<input className="field mt-1" value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Asia/Kolkata" required /></label>
        <button className="btn" disabled={busy} type="submit">Save journey clock</button>
      </form>
      {message && <p className="text-sm text-olive" role="status">{message}</p>}
    </section>
  );
}

function dateTimeToZone(value: string, timeZone: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcTarget = Date.UTC(year, month - 1, day, hour, minute);
  let guess = utcTarget;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const valueOf = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(valueOf("year"), valueOf("month") - 1, valueOf("day"), valueOf("hour"), valueOf("minute"));
    guess += utcTarget - represented;
  }
  return new Date(guess).toISOString();
}

function dateTimeInZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
