"use client";

import { useCallback, useEffect, useState } from "react";
import { TicketView, type TicketData } from "@/components/ticket-view";

type LookupState = "idle" | "scanning" | "found" | "unknown" | "error" | "requested";

export function TicketLookup({ initialUsername = "" }: { initialUsername?: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [state, setState] = useState<LookupState>("idle");
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [message, setMessage] = useState("");

  const lookup = useCallback(async (raw: string) => {
    setTicket(null);
    setMessage("");
    setState("scanning");
    try {
      const response = await fetch("/api/ticket-lookup", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: raw }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Ticket lookup failed.");
      if (!body.found) { setState("unknown"); return; }
      setTicket(body.ticket as TicketData);
      setState("found");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ticket lookup is temporarily unavailable.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!initialUsername) return;
    const timer = window.setTimeout(() => void lookup(initialUsername), 0);
    return () => window.clearTimeout(timer);
  }, [initialUsername, lookup]);

  async function requestBoarding() {
    setMessage("");
    try {
      const response = await fetch("/api/boarding-request", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Request could not be saved.");
      setState("requested");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request could not be saved.");
    }
  }

  return (
    <section id="find-ticket" className="space-y-5">
      <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <div className="panel p-5 sm:p-7">
          <p className="kicker">NIGHTLINE · passenger terminal</p>
          <h1 className="display mt-3 text-5xl leading-none sm:text-6xl">Find your ticket.</h1>
          <p className="mt-4 max-w-xl text-muted">Check whether your passenger identity is ready. For privacy, this lookup never reveals whether another account has a ticket.</p>
          <form className="mt-6 space-y-3" onSubmit={(event) => { event.preventDefault(); void lookup(username); }}>
            <label className="block text-sm" htmlFor="ticket-username">Instagram username</label>
            <input id="ticket-username" className="field text-lg" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} maxLength={300} placeholder="@username" value={username} onChange={(event) => setUsername(event.target.value)} />
            <button className="btn w-full sm:w-auto" type="submit" disabled={!username.trim() || state === "scanning"}>{state === "scanning" ? "Scanning manifest…" : "Find my ticket"}</button>
          </form>
          {state === "scanning" && <p className="manifest-scan mt-4 text-sm text-amber" role="status">Checking the latest passenger manifest…</p>}
          {state === "unknown" && <div className="mt-5 space-y-3 border-t border-line pt-4 text-sm" role="status">
            <p className="text-amber">Continue in Instagram to securely claim your ticket.</p>
            <p className="text-muted">Open a DM with @NIGHTLINE and send <strong>BOARD</strong>. The claim service checks the account identity before returning ticket details. If automated claiming is unavailable, you can request a manifest review below.</p>
            <a className="btn" href="https://ig.me/m/NIGHTLINE" target="_blank" rel="noreferrer">Open Instagram</a>
            <button className="btn secondary" type="button" onClick={requestBoarding}>Request a boarding update</button>
          </div>}
          {state === "requested" && <p className="mt-5 text-sm text-olive" role="status">Boarding request received. This is provisional acknowledgement only; no passenger number or ticket has been issued.</p>}
          {state === "error" && <p className="mt-4 text-sm text-danger" role="alert">{message}</p>}
        </div>

        <div className="space-y-4">
          {ticket ? <TicketView ticket={ticket} /> : <div className="ticket-metal panel flex min-h-64 flex-col justify-between p-6" aria-label="Empty passenger ticket preview">
            <div><p className="kicker">Passenger ticket · preview</p><p className="display mt-5 text-3xl text-muted">Awaiting identity</p><p className="mt-3 text-sm text-muted">Your permanent passenger number appears here when your username is in the verified follower manifest.</p></div>
            <div className="flex items-end justify-between border-t border-line pt-4"><span className="mono text-xs text-muted">NIGHTLINE · UNKNOWN</span><span className="text-3xl text-amber">✳</span></div>
          </div>}
          <aside className="panel p-4 text-xs text-muted">
            <p className="kicker">Passenger classes</p>
            <p className="mt-2">100–199 Luxury · 200–499 Silver · 500–999 Bronze · 1000+ Regular.</p>
            <p className="mt-2">Passenger identity and physical accommodation are separate. A seat upgrade never changes the permanent passenger number.</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
