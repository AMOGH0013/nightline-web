import Link from "next/link";
import { getRuntime } from "@/lib/env";
import { getSession } from "@/lib/session";
import { isAdmin, readJourneyClock, readOwned } from "@/lib/passengers";

const links = [
  ["Manifest", "/manifest"],
  ["Archive", "/archive"],
  ["Vote", "/vote"],
  ["Store", "/store"],
];

export async function SiteShell({ children }: { children: React.ReactNode }) {
  const runtime = getRuntime();
  const session = runtime.mode === "misconfigured" ? null : await getSession().catch(() => null);
  const passenger = session ? await readOwned(session.userId).catch(() => null) : null;
  const admin = session ? await isAdmin(session.userId).catch(() => false) : false;
  const journey = await readJourneyClock().catch(() => ({ journeyDay: null, launchAt: null, timezone: "Asia/Kolkata" }));

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      {runtime.mode === "local" && (
        <div className="bg-[#2a261c] px-4 py-2 text-center text-xs text-[#e7d7b0] mono">
          Local development mode. Sign-in codes are shown on this machine and are not production authentication.
          No Supabase project is connected.
        </div>
      )}
      {runtime.mode === "misconfigured" && (
        <div className="bg-[#3a2420] px-4 py-2 text-center text-xs text-[#f0d2cb] mono">
          Supabase environment is incomplete. Set the URL, anon key and service role key together, or leave all three blank for local mode.
        </div>
      )}
      <header className="border-b border-line/80 bg-soot/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="display text-xl tracking-[0.22em]">
            Nightline
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm text-muted">
            <span className="mono text-xs text-amber">{journey.journeyDay ? `JOURNEY DAY ${String(journey.journeyDay).padStart(2, "0")}` : "PRE-BOARDING"}</span>
            {links.map(([label, href]) => (
              <Link key={href} href={href} className="hover:text-ink">
                {label}
              </Link>
            ))}
            {passenger ? <Link href="/dashboard" className="hover:text-ink">Terminal</Link> : null}
            {passenger ? <Link href="/ticket" className="hover:text-ink">Ticket</Link> : null}
            {admin ? <Link href="/admin" className="hover:text-ink">Admin</Link> : null}
            <Link href={passenger ? "/profile" : "/#find-ticket"} className="btn !min-h-0 !px-3 !py-2">
              {passenger ? "Profile" : "Find ticket"}
            </Link>
            {session ? (
              <form action="/api/auth/logout" method="post">
                <button className="text-sm text-muted hover:text-ink" type="submit">Sign out</button>
              </form>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-xs text-muted mono">
          <span>Nightline passenger terminal · destination unknown</span>
          <span className="flex gap-4">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
