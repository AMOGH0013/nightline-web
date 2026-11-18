import "server-only";
import { query, withTransaction } from "@/lib/db";

export async function searchPassengers(q: string) {
  return query<{
    user_id: string;
    email: string | null;
    display_name: string;
    kind: string;
    passenger_number: number | null;
    stowaway_number: number | null;
    seat_class: string;
    carriage: number | null;
    seat_label: string | null;
    special_role: string | null;
    permanent_number: number | null;
    follower_rank: number | null;
    original_entitlement: string | null;
    luxury_seat_code: string | null;
    moderation: string;
    is_listed: boolean;
    instagram_handle: string | null;
    handle_verified: boolean;
    anonymised_at: string | null;
    messaging_claimed: boolean;
  }>(
    `select p.user_id, u.email, pr.display_name, p.kind, p.passenger_number, p.stowaway_number,
            p.permanent_number,p.follower_rank,p.original_entitlement,ls.seat_code as luxury_seat_code,
            p.seat_class, p.carriage, p.seat_label, p.special_role, pr.moderation::text,
            pr.is_listed, pr.instagram_handle, pr.handle_verified, pr.anonymised_at::text as anonymised_at,
            exists(select 1 from public.messaging_identities mi where mi.passenger_id=p.id) as messaging_claimed
     from public.passengers p
     join public.profiles pr on pr.id = p.user_id
     left join auth.users u on u.id = p.user_id
     left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
     where $1::text is null
        or pr.display_name ilike '%' || $1 || '%'
        or coalesce(u.email, '') ilike '%' || $1 || '%'
        or coalesce(pr.instagram_handle, '') ilike '%' || $1 || '%'
        or p.passenger_number::text = $1
        or p.permanent_number::text = $1
        or p.follower_rank::text = $1
        or p.stowaway_number::text = $1
        or p.seat_label = $1
     order by p.issued_at desc
     limit 50`,
    [q || null],
  );
}

export async function readLuxurySeatInventory() {
  return query<{
    seat_code: string; seat_number: number; pool: string; price_inr: number | null;
    sale_approved: boolean; status: string; assignment_type: string | null;
    permanent_number: number | null; instagram_handle: string | null;
  }>(`select ls.seat_code,ls.seat_number,ls.pool,ls.price_inr,ls.sale_approved,ls.status,ls.assignment_type,
      p.permanent_number,case when pr.handle_public then pr.instagram_handle end as instagram_handle
     from public.luxury_seat_inventory ls
     left join public.passengers p on p.id=ls.passenger_id
     left join public.profiles pr on pr.id=p.user_id order by ls.seat_number`);
}

export async function configureLuxurySeat(input: { seatCode: string; priceInr: number | null; saleApproved: boolean; actorId: string }) {
  return withTransaction(async (run) => {
    const [seat] = await run<{ pool: string; status: string; passenger_id: string | null }>(
      "select pool,status,passenger_id from public.luxury_seat_inventory where seat_code=$1 for update", [input.seatCode]);
    if (!seat) throw new Error("seat_unavailable");
    if (seat.passenger_id || ["held", "pending_payment"].includes(seat.status)) throw new Error("seat_already_allocated");
    if (seat.pool === "follower_entitlement") throw new Error("follower_seat_not_for_sale");
    if (input.saleApproved && input.priceInr === null) throw new Error("seat_price_required");
    const status = input.priceInr === null ? "blocked" : (input.saleApproved ? "available" : "blocked");
    await run(`update public.luxury_seat_inventory set price_inr=$2,sale_approved=$3,status=$4,updated_at=pg_catalog.now()
      where seat_code=$1`, [input.seatCode,input.priceInr,input.saleApproved,status]);
    await run(`insert into public.audit_log(actor,action,subject,detail) values($1,'luxury.seat.configured',$2,$3::jsonb)`,
      [input.actorId,input.seatCode,JSON.stringify({priceInr:input.priceInr,saleApproved:input.saleApproved})]);
  });
}

export async function readJourneySettings() {
  const [row] = await query<{ launch_at: string | null; timezone: string }>(
    "select launch_at::text,timezone from public.journey_settings where id=1");
  return row ?? { launch_at: null, timezone: "Asia/Kolkata" };
}

export async function configureJourney(input: { launchAt: string | null; timezone: string; actorId: string }) {
  return withTransaction(async (run) => {
    const [zone] = await run<{ valid: boolean }>("select exists(select 1 from pg_catalog.pg_timezone_names where name=$1) as valid", [input.timezone]);
    if (!zone?.valid) throw new Error("invalid_timezone");
    await run(`update public.journey_settings set launch_at=$1,timezone=$2,updated_by=$3,updated_at=pg_catalog.now() where id=1`,
      [input.launchAt,input.timezone,input.actorId]);
    await run(`insert into public.audit_log(actor,action,subject,detail) values($1,'journey.settings.changed','global',$2::jsonb)`,
      [input.actorId,JSON.stringify({launchAt:input.launchAt,timezone:input.timezone})]);
  });
}

export async function allocationSummary() {
  const [row] = await query<{ imported_followers: number; luxury_entitlements: number; highest_passenger_number: number | null }>(
    `select count(*)::int as imported_followers,
       count(*) filter (where follower_rank between 1 and 100)::int as luxury_entitlements,
       max(permanent_number)::int as highest_passenger_number
     from public.passengers where follower_rank is not null and permanent_number is not null`,
  );
  return {
    importedFollowers: row?.imported_followers ?? 0,
    luxuryEntitlements: row?.luxury_entitlements ?? 0,
    highestPassengerNumber: row?.highest_passenger_number ?? null,
  };
}

export async function readPassengerOperations() {
  const [row] = await query<{
    total_passengers: number; imported_followers: number; claimed_followers: number;
    luxury_occupied: number; luxury_available: number; imports_requiring_review: number;
  }>(`select
      count(*) filter (where p.permanent_number is not null)::int as total_passengers,
      count(*) filter (where p.follower_rank is not null)::int as imported_followers,
      count(*) filter (where p.follower_rank is not null and exists(select 1 from public.messaging_identities mi where mi.passenger_id=p.id))::int as claimed_followers,
      (select count(*)::int from public.luxury_seat_inventory where status='sold') as luxury_occupied,
      (select count(*)::int from public.luxury_seat_inventory where pool='premium' and status='available' and sale_approved)::int as luxury_available,
      (select count(*)::int from public.follower_manifest_imports where status='preview' or late_historical_records>0)::int as imports_requiring_review
    from public.passengers p`);
  return {
    totalPassengers: row?.total_passengers ?? 0,
    importedFollowers: row?.imported_followers ?? 0,
    claimedFollowers: row?.claimed_followers ?? 0,
    unclaimedFollowers: Math.max(0, (row?.imported_followers ?? 0) - (row?.claimed_followers ?? 0)),
    luxuryOccupied: row?.luxury_occupied ?? 0,
    luxuryAvailable: row?.luxury_available ?? 0,
    importsRequiringReview: row?.imports_requiring_review ?? 0,
    integrationStatus: process.env.MANYCHAT_WEBHOOK_SECRET && Buffer.byteLength(process.env.MANYCHAT_WEBHOOK_SECRET) >= 32
      ? "Secret configured · live delivery unverified" : "Not configured",
  };
}

export async function readMessagingFailures() {
  return query<{ username:string|null; status:string; occurred_at:string }>(`select username,status,occurred_at::text as occurred_at
    from public.messaging_claim_attempts where status in ('not_found','conflict','invalid','rate_limited')
      and occurred_at>pg_catalog.now()-interval '30 days' order by occurred_at desc limit 25`);
}

export async function readRoles() {
  return query<{ key: string; label: string; enabled: boolean; note: string | null }>(
    `select key, label, enabled, note from public.role_definitions order by key`,
  );
}

export async function readSubmissions() {
  return query<{
    id: string;
    display_name: string;
    body: string;
    status: string;
    created_at: string;
  }>(
    `select s.id, pr.display_name, s.body, s.status, s.created_at::text as created_at
     from public.submissions s
     join public.profiles pr on pr.id = s.user_id
     order by s.created_at desc limit 40`,
  );
}

export async function readAdminPolls() {
  return query<{ id: string; title: string; closes_at: string; published: boolean }>(
    `select id, title, closes_at::text as closes_at, published from public.polls order by created_at desc limit 20`,
  );
}

type Run = typeof query;

export async function setRoleEnabled(key: string, enabled: boolean) {
  await query(`update public.role_definitions set enabled = $2 where key = $1`, [key, enabled]);
}

export async function assignRole(userId: string, role: string | null) {
  if (role) {
    const [definition] = await query<{ enabled: boolean }>(
      `select enabled from public.role_definitions where key = $1`,
      [role],
    );
    if (!definition?.enabled) throw new Error("role_disabled");
  }
  const rows = await query(`update public.passengers set special_role = $2 where user_id = $1 returning id`, [
    userId,
    role,
  ]);
  if (rows.length !== 1) throw new Error("passenger_missing");
}

export async function setModeration(userId: string, moderation: string) {
  await query(`update public.profiles set moderation = $2::public.moderation_status where id = $1`, [
    userId,
    moderation,
  ]);
}

export async function setListed(userId: string, listed: boolean) {
  await query(`update public.profiles set is_listed = $2 where id = $1`, [userId, listed]);
}

export async function verifyHandle(userId: string, verified: boolean) {
  await withTransaction(async (run: Run) => {
    await run(`select set_config('request.jwt.claim.role', '', true)`);
    await run(`select public.set_handle_verified($1, $2)`, [userId, verified]);
  });
}

export async function createPoll(input: {
  title: string;
  story: string;
  options: string[];
  opensAt: string;
  closesAt: string;
  showResults: string;
}) {
  await withTransaction(async (run: Run) => {
    const [poll] = await run<{ id: string }>(
      `insert into public.polls (title, story, opens_at, closes_at, show_results, published)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [input.title, input.story, input.opensAt, input.closesAt, input.showResults],
    );
    for (const [index, label] of input.options.entries()) {
      await run(`insert into public.poll_options (poll_id, label, position) values ($1, $2, $3)`, [
        poll.id,
        label,
        index,
      ]);
    }
  });
}

export async function publishEpisode(input: { number: number; title: string; summary: string }) {
  await query(
    `insert into public.episodes (number, title, summary, published, published_at)
     values ($1, $2, $3, true, now())`,
    [input.number, input.title, input.summary],
  );
}

export async function publishArchive(input: { kind: string; title: string; body: string; occurredOn?: string }) {
  await query(
    `insert into public.archive_entries (kind, title, body, occurred_on, published)
     values ($1, $2, $3, $4::date, true)`,
    [input.kind, input.title, input.body, input.occurredOn || null],
  );
}

export async function archivePoll(pollId: string) {
  const results = await query<{ label: string; votes: string }>(
    `select label, votes from public.poll_results($1)`,
    [pollId],
  );
  const [poll] = await query<{ title: string }>(`select title from public.polls where id = $1`, [pollId]);
  if (!poll) throw new Error("poll_missing");
  const body = results.length
    ? results.map((row) => `${row.label}: ${row.votes}`).join("\n")
    : "No public tally was available for this poll.";
  await query(
    `insert into public.archive_entries (kind, title, body, occurred_on, published, source_poll_id)
     select 'vote_outcome', $2, $3, current_date, true, $1
     where not exists (select 1 from public.archive_entries where source_poll_id = $1)`,
    [pollId, `Vote closed — ${poll.title}`, body],
  );
}

export async function updateTrain(input: { state: string; headline: string; detail?: string }) {
  await query(
    `update public.train_status set state = $1, headline = $2, detail = $3, updated_at = now() where id = 1`,
    [input.state, input.headline, input.detail || null],
  );
}

export async function publishTransmission(input: { title: string; body: string }) {
  await query(
    `insert into public.transmissions (title, body, published, published_at) values ($1, $2, true, now())`,
    [input.title, input.body],
  );
}

export async function publishAnnouncement(input: { title: string; body: string; active: boolean }) {
  await query(`insert into public.announcements (title, body, active) values ($1, $2, $3)`, [
    input.title,
    input.body,
    input.active,
  ]);
}

export async function reviewSubmission(id: string, status: string) {
  await query(`update public.submissions set status = $2 where id = $1`, [id, status]);
}

export async function setRegistrationOpen(open: boolean) {
  await query(`update public.site_settings set value = $2::jsonb, updated_at = now() where key = 'registration_open'`, [
    open,
    open ? "true" : "false",
  ]);
}

export async function awardAchievement(userId: string, key: string, label: string) {
  await withTransaction(async (run: Run) => {
    await run(
      `insert into public.achievements (key, label) values ($1, $2)
       on conflict (key) do update set label = excluded.label`,
      [key, label],
    );
    const [passenger] = await run<{ id: string }>(`select id from public.passengers where user_id = $1`, [userId]);
    if (!passenger) throw new Error("passenger_missing");
    await run(
      `insert into public.passenger_achievements (passenger_id, achievement_key) values ($1, $2)
       on conflict do nothing`,
      [passenger.id, key],
    );
  });
}

export async function addStamp(userId: string, label: string, note: string) {
  const [passenger] = await query<{ id: string }>(`select id from public.passengers where user_id = $1`, [userId]);
  if (!passenger) throw new Error("passenger_missing");
  await query(`insert into public.stamps (passenger_id, label, note) values ($1, $2, nullif($3, ''))`, [
    passenger.id,
    label,
    note,
  ]);
}

export async function publishDiscovery(input: { title: string; body: string }) {
  await query(`insert into public.discoveries (title, body, published) values ($1, $2, true)`, [
    input.title,
    input.body,
  ]);
}
