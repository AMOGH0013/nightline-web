import { AdminConsole } from "@/components/admin-console";
import { allocationSummary, readAdminPolls, readJourneySettings, readLuxurySeatInventory, readMessagingFailures, readPassengerOperations, readRoles, readSubmissions, searchPassengers } from "@/lib/admin";
import { readFollowerImportHistory } from "@/lib/followers";
import { readJourneyClock } from "@/lib/passengers";
import { isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session || !(await isAdmin(session.userId))) {
    return (
      <section className="panel max-w-xl p-6">
        <h1 className="display text-4xl">Sealed</h1>
        <p className="mt-3 text-muted">This console is only available to an authorised administrator.</p>
      </section>
    );
  }
  const params = await searchParams;
  const [passengers, summary, roles, submissions, polls, followerImports, luxurySeats, journeySettings, journeyClock, passengerOperations, claimFailures] = await Promise.all([
    searchPassengers(params.q ?? ""),
    allocationSummary(),
    readRoles(),
    readSubmissions(),
    readAdminPolls(),
    readFollowerImportHistory(),
    readLuxurySeatInventory(),
    readJourneySettings(),
    readJourneyClock(),
    readPassengerOperations(),
    readMessagingFailures(),
  ]);
  return (
    <AdminConsole
      query={params.q ?? ""}
      passengers={passengers}
      summary={summary}
      roles={roles}
      submissions={submissions}
      polls={polls}
      followerImports={followerImports}
      luxurySeats={luxurySeats}
      journeySettings={journeySettings}
      journeyDay={journeyClock.journeyDay}
      passengerOperations={passengerOperations}
      claimFailures={claimFailures}
    />
  );
}
