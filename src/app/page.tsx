import Link from "next/link";
import { readLatestTransmission } from "@/lib/content";
import { readStats } from "@/lib/passengers";
import { TicketLookup } from "@/components/ticket-lookup";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  const params = await searchParams;
  const [stats, transmission] = await Promise.all([
    readStats().catch(() => null),
    readLatestTransmission().catch(() => null),
  ]);

  return (
    <div className="space-y-16">
      <TicketLookup initialUsername={params.ticket ?? ""} />
      <section className="grid items-end gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rise">
          <p className="kicker">Internal passenger terminal</p>
          <h1 className="display mt-4 text-6xl leading-none sm:text-8xl">Nightline</h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            The city is ruined. One heavy industrial train is still operational. Its destination is not on any board that survived.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn" href="/#find-ticket">Find your ticket</Link>
            <Link className="btn secondary" href="/manifest">Passenger manifest</Link>
          </div>
        </div>
        <figure className="panel overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/hero.png" alt="The Nightline locomotive in a ruined city" className="h-72 w-full object-cover sm:h-96" />
          <figcaption className="flex items-center justify-between px-4 py-3 text-xs mono text-muted">
            <span>Destination</span>
            <span className="text-amber">UNKNOWN</span>
          </figcaption>
        </figure>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Imported follower passengers" value={stats ? String(stats.importedFollowers) : "—"} />
        <Stat label="First 100 Luxury entitlements" value={stats ? String(stats.luxuryEntitlements) : "—"} />
        <Stat label="Highest permanent passenger number" value={stats?.highestPassengerNumber ? String(stats.highestPassengerNumber) : stats ? "Not assigned" : "—"} />
      </section>
      {!stats && (
        <p className="text-sm text-danger">The live counter is unavailable because the database is not connected.</p>
      )}

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <p className="kicker">The world</p>
          <h2 className="display mt-2 text-4xl">After the city</h2>
          <p className="mt-4 text-muted">
            High-rises stand open to the weather. Streets are buried in rubble, smoke and dirty light. Nightline is not a fantasy railway. It is the last machine still moving through what remains of a modern city.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/world.png" alt="Ruined streets under a low sun" className="mt-5 h-56 w-full object-cover panel" />
        </div>
        <div>
          <p className="kicker">The train</p>
          <h2 className="display mt-2 text-4xl">Still operational</h2>
          <p className="mt-4 text-muted">
            The locomotive is long, low and weathered olive-grey: a diesel utility engine with tanks, grilles, lamps and visible wheels. Passengers board it without being told where the line ends.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/locomotive.png" alt="Side view of the industrial locomotive" className="mt-5 h-56 w-full object-cover panel" />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="panel p-6">
          <p className="kicker">Chronological identity</p>
          <h2 className="display mt-2 text-3xl">Permanent passenger numbers</h2>
          <p className="mt-3 text-muted">
            The first verified follower is Passenger 100. Each following rank receives the next permanent number. The identity is never reused or changed by a name change or accommodation upgrade.
          </p>
        </article>
        <article className="panel p-6">
          <p className="kicker">Separate seat inventory</p>
          <h2 className="display mt-2 text-3xl">Entitlement and accommodation</h2>
          <p className="mt-3 text-muted">
            Passenger numbers 100–199 carry the original Luxury entitlement, 200–499 Silver, 500–999 Bronze and 1000 onward Regular. A physical Luxury seat such as L-001 is a separate identifier.
          </p>
        </article>
      </section>

      <section>
        <p className="kicker">Classes</p>
        <h2 className="display mt-2 text-4xl">Permanent classes</h2>
        <div className="mt-5 overflow-x-auto panel">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-muted mono">
              <tr>
                <th className="px-4 py-3 font-normal">Passenger number</th>
                <th className="px-4 py-3 font-normal">Original entitlement</th>
                <th className="px-4 py-3 font-normal">Accommodation</th>
              </tr>
            </thead>
            <tbody>
              {[["100–199", "Luxury", "L-100–L-199 entitlement"], ["200–499", "Silver", "Silver"], ["500–999", "Bronze", "Bronze"], ["1000+", "Regular", "Regular"]].map(([number, entitlement, accommodation]) => (
                <tr key={number} className="border-t border-line">
                  <td className="px-4 py-3">{number}</td>
                  <td className="px-4 py-3">{entitlement}</td>
                  <td className="px-4 py-3 text-muted">{accommodation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          Premium numbered seats have creator-configured prices in the catalogue. Unapproved inventory stays blocked, and checkout is disabled. Passenger identity never changes when accommodation does.
        </p>
        <Link className="btn secondary mt-4" href="/store">Open the catalogue</Link>
      </section>

      <section className="panel p-6 sm:p-8">
        <p className="kicker">Latest transmission</p>
        {transmission ? (
          <>
            <h2 className="display mt-2 text-4xl">{transmission.title}</h2>
            <p className="mt-4 max-w-3xl whitespace-pre-wrap text-muted">{transmission.body}</p>
          </>
        ) : (
          <>
            <h2 className="display mt-2 text-4xl">The line is quiet</h2>
            <p className="mt-4 text-muted">No transmission has been published yet. The archive will hold episodes, decisions and discoveries when the creator posts them.</p>
          </>
        )}
        <Link className="mt-5 inline-block text-sm text-amber underline" href="/archive">Journey archive</Link>
      </section>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-5">
      <p className="kicker">{label}</p>
      <p className="display mt-2 text-5xl">{value}</p>
    </div>
  );
}
