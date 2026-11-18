import "server-only";
import { connection } from "next/server";
import { dbMessage, query, withTransaction } from "@/lib/db";
import { getRuntime } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

type Query = typeof query;

export type Settings = {
  termsVersion: string;
  privacyVersion: string;
  paymentsEnabled: boolean;
  registrationOpen: boolean;
  passenger500Rule: string;
};

export type Stats = {
  importedFollowers: number;
  luxuryEntitlements: number;
  highestPassengerNumber: number | null;
};

export type ManifestRow = {
  kind: "founding" | "stowaway";
  passenger_number: number | null;
  stowaway_number: number | null;
  display_name: string;
  seat_class: string;
  carriage: number | null;
  seat_label: string | null;
  special_role: string | null;
  instagram_handle: string | null;
  handle_verified: boolean;
  achievements: string[] | null;
  permanent_number: number | null;
  follower_rank: number | null;
  original_entitlement: string | null;
  current_accommodation: string;
  luxury_seat_code: string | null;
  boarding_day: number | null;
};

export type OwnedPassenger = {
  passenger_id: string;
  user_id: string;
  kind: "founding" | "stowaway";
  passenger_number: number | null;
  stowaway_number: number | null;
  seat_class: string;
  carriage: number | null;
  seat_label: string | null;
  special_role: string | null;
  role_label: string | null;
  issued_at: string;
  serial: string;
  verification_code: string;
  display_name: string;
  instagram_handle: string | null;
  handle_public: boolean;
  handle_verified: boolean;
  is_listed: boolean;
  bio: string | null;
  moderation: string;
  anonymised_at: string | null;
  terms_version: string | null;
  privacy_version: string | null;
  terms_accepted_at: string | null;
  created_at: string;
  account_user_id: string | null;
  permanent_number: number | null;
  follower_rank: number | null;
  original_entitlement: string | null;
  luxury_seat_code: string | null;
  boarded_at: string | null;
  boarded_on_journey_day: number | null;
  video_consent: boolean;
};

const OWNED = `
  select p.id as passenger_id, p.user_id, p.account_user_id, p.kind, p.passenger_number, p.stowaway_number,
         p.permanent_number, p.follower_rank, p.original_entitlement, ls.seat_code as luxury_seat_code,
         p.boarded_at, p.boarded_on_journey_day, coalesce(vc.allowed,false) as video_consent,
         p.seat_class, p.carriage, p.seat_label, p.special_role, r.label as role_label,
         p.issued_at, t.serial, t.verification_code, pr.display_name, pr.instagram_handle,
         pr.handle_public, pr.handle_verified, pr.is_listed, pr.bio, pr.moderation::text,
         pr.anonymised_at, pr.terms_version, pr.privacy_version, pr.terms_accepted_at, pr.created_at
  from public.passengers p
  join public.profiles pr on pr.id = p.user_id
  join public.tickets t on t.passenger_id = p.id
  left join public.role_definitions r on r.key = p.special_role
  left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
  left join public.passenger_video_consent vc on vc.passenger_id=p.id
`;

export async function readSettings(): Promise<Settings> {
  await connection();
  const rows = await query<{ key: string; value: string }>(
    `select key, value #>> '{}' as value from public.site_settings
     where key in ('terms_version','privacy_version','payments_enabled','registration_open','passenger_500_rule')`,
  );
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    termsVersion: map.terms_version ?? "",
    privacyVersion: map.privacy_version ?? "",
    paymentsEnabled: map.payments_enabled === "true",
    registrationOpen: map.registration_open === "true",
    passenger500Rule: map.passenger_500_rule ?? "undecided",
  };
}

export async function readStats(): Promise<Stats> {
  await connection();
  const [row] = await query<{ imported_followers: string; luxury_entitlements: string; highest_passenger_number: string | null }>(
    `select count(*)::text as imported_followers,
       count(*) filter (where follower_rank between 1 and 100)::text as luxury_entitlements,
       max(permanent_number)::text as highest_passenger_number
     from public.passengers where follower_rank is not null and permanent_number is not null`,
  );
  return {
    importedFollowers: Number(row?.imported_followers ?? 0),
    luxuryEntitlements: Number(row?.luxury_entitlements ?? 0),
    highestPassengerNumber: row?.highest_passenger_number === null || row?.highest_passenger_number === undefined
      ? null : Number(row.highest_passenger_number),
  };
}

export async function readOwned(userId: string) {
  await connection();
  const [row] = await query<OwnedPassenger>(`${OWNED} where coalesce(p.account_user_id,p.user_id) = $1`, [userId]);
  return row ?? null;
}

export async function isAdmin(userId: string) {
  const [row] = await query<{ ok: boolean }>(
    "select exists(select 1 from public.admin_users where user_id = $1) as ok",
    [userId],
  );
  return Boolean(row?.ok);
}

async function bindUser(run: Query, userId: string) {
  await run(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await run(`select set_config('request.jwt.claim.role', '', true)`);
}

export async function registerPassenger(input: {
  userId: string;
  displayName: string;
  instagram: string;
  termsVersion: string;
  privacyVersion: string;
}) {
  if (getRuntime().mode === "supabase" && !process.env.DATABASE_URL) {
    return registerThroughSupabase(input);
  }
  return withTransaction(async (run) => {
    await bindUser(run, input.userId);
    const rows = await run<{
      passenger_id: string;
      kind: "founding" | "stowaway";
      passenger_number: number | null;
      stowaway_number: number | null;
      seat_label: string | null;
      ticket_serial: string;
      verification_code: string;
      already_registered: boolean;
    }>(
      `select * from public.register_passenger($1,$2,$3,true,$4,$5)`,
      [input.userId, input.displayName, input.instagram || null, input.termsVersion, input.privacyVersion],
    );
    const allocated = rows[0];
    if (!allocated) throw new Error("allocation_failed");
    if (!allocated.already_registered) {
      await run(
        `insert into public.journey_events (passenger_id, title, body)
         values ($1, 'Boarded', 'The ticket was issued and the passenger joined the line.')`,
        [allocated.passenger_id],
      );
    }
    return allocated;
  });
}

async function registerThroughSupabase(input: {
  userId: string;
  displayName: string;
  instagram: string;
  termsVersion: string;
  privacyVersion: string;
}) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("register_passenger", {
    p_user_id: input.userId,
    p_display_name: input.displayName,
    p_instagram: input.instagram || null,
    p_terms: true,
    p_terms_version: input.termsVersion,
    p_privacy_version: input.privacyVersion,
  });
  if (error) throw error;
  const allocated = (Array.isArray(data) ? data[0] : data) as {
    passenger_id: string;
    kind: "founding" | "stowaway";
    ticket_serial: string;
    already_registered: boolean;
  };
  if (!allocated?.passenger_id) throw new Error("allocation_failed");
  if (!allocated.already_registered) {
    const journey = await admin.from("journey_events").insert({
      passenger_id: allocated.passenger_id,
      title: "Boarded",
      body: "The ticket was issued and the passenger joined the line.",
    });
    if (journey.error) throw journey.error;
  }
  return allocated;
}

export async function updateProfile(
  userId: string,
  input: { displayName: string; instagram: string; bio: string; handlePublic: boolean; listed: boolean; videoConsent?: boolean },
) {
  return withTransaction(async (run) => {
    const rows = await run<{ id: string; passenger_id: string }>(
      `update public.profiles pr
         set display_name=$2, instagram_handle=nullif($3,''), handle_public=$4,
             is_listed=$5, bio=nullif($6,'')
       where pr.id=(select p.user_id from public.passengers p where coalesce(p.account_user_id,p.user_id)=$1)
         and pr.anonymised_at is null
       returning pr.id, (select p.id from public.passengers p where p.user_id=pr.id) as passenger_id`,
      [userId, input.displayName, input.instagram, input.handlePublic, input.listed, input.bio],
    );
    const row = rows[0];
    if (!row) return false;
    const [priorConsent] = input.videoConsent === undefined
      ? await run<{ allowed: boolean }>(`select allowed from public.passenger_video_consent where passenger_id=$1`, [row.passenger_id])
      : [];
    const allowed = input.videoConsent ?? priorConsent?.allowed ?? false;
    await run(
      `insert into public.passenger_video_consent(passenger_id,allowed,approved_public_label,updated_at)
       values($1,$2,case when $2 then $3 else null end,pg_catalog.now())
       on conflict(passenger_id) do update set allowed=excluded.allowed,
         approved_public_label=excluded.approved_public_label,updated_at=pg_catalog.now()`,
      [row.passenger_id, allowed, input.displayName],
    );
    await run(
      `insert into public.passenger_video_consent_history(passenger_id,account_user_id,allowed,approved_public_label)
       values($1,$2,$3,case when $3 then $4 else null end)`,
      [row.passenger_id, userId, allowed, input.displayName],
    );
    return true;
  });
}

export async function anonymiseOwn(userId: string) {
  await withTransaction(async (run) => {
    await bindUser(run, userId);
    await run(`select public.anonymise_passenger($1)`, [userId]);
  });
}

export async function readManifest(filters: {
  q?: string;
  seatClass?: string;
  carriage?: number;
  role?: string;
  boardingDay?: number;
}) {
  await connection();
  return query<ManifestRow>(
    `select kind, passenger_number, stowaway_number, display_name, seat_class, carriage,
            seat_label, special_role, instagram_handle, handle_verified, achievements,
            permanent_number, follower_rank, original_entitlement, current_accommodation,
            luxury_seat_code, boarding_day
     from public.manifest
     where ($1::text is null or display_name ilike '%' || $1 || '%' or coalesce(instagram_handle, '') ilike '%' || $1 || '%'
            or permanent_number::text = $1 or follower_rank::text = $1)
       and ($2::text is null or seat_class = $2)
       and ($3::int is null or carriage = $3)
       and ($4::text is null or special_role = $4)
       and ($5::int is null or boarding_day = $5)
     order by permanent_number nulls last, kind, passenger_number nulls last, stowaway_number
     limit 200`,
    [filters.q || null, filters.seatClass || null, filters.carriage ?? null, filters.role || null, filters.boardingDay ?? null],
  );
}

export async function verifyCode(code: string) {
  await connection();
  const [row] = await query<{
    serial: string;
    kind: "founding" | "stowaway";
    passenger_number: number | null;
    stowaway_number: number | null;
    permanent_number: number | null;
    follower_rank: number | null;
    original_entitlement: string | null;
    current_accommodation: string;
    seat_class: string;
    luxury_seat_code: string | null;
    display_name: string | null;
    carriage: number | null;
    seat_label: string | null;
    special_role: string | null;
    instagram_handle: string | null;
    handle_verified: boolean;
    identity_public: boolean;
    issued_at: string;
    boarded_on_journey_day: number | null;
    ticket_status: string;
  }>("select * from public.verify_passenger_ticket($1)", [code]);
  return row ?? null;
}

export async function findPublicPassengerTicket(username: string) {
  await connection();
  const [row] = await query<{
    normalized_username: string;
    follower_rank: number | null;
    permanent_number: number | null;
    original_entitlement: string | null;
    current_accommodation: string;
    carriage: number | null;
    seat_label: string | null;
    boarded_at: string | null;
    boarded_on_journey_day: number | null;
    kind: "founding" | "stowaway";
    passenger_number: number | null;
    stowaway_number: number | null;
    display_name: string;
    instagram_handle: string;
    handle_verified: boolean;
    handle_public: boolean;
    special_role: string | null;
    role_label: string | null;
    issued_at: string;
    serial: string;
    verification_code: string;
    luxury_seat_code: string | null;
    ticket_status: string;
  }>("select * from public.passenger_ticket_lookup where normalized_username=$1", [username]);
  return row ?? null;
}

export async function consumeUsernameLookupLimit(keyHash: string) {
  const [row] = await query<{ request_count: number }>(
    `insert into public.username_lookup_rate_limits(key_hash,window_started_at,request_count)
     values($1,pg_catalog.now(),1)
     on conflict(key_hash) do update set
       request_count=case when public.username_lookup_rate_limits.window_started_at < pg_catalog.now()-interval '10 minutes'
         then 1 else public.username_lookup_rate_limits.request_count+1 end,
       window_started_at=case when public.username_lookup_rate_limits.window_started_at < pg_catalog.now()-interval '10 minutes'
         then pg_catalog.now() else public.username_lookup_rate_limits.window_started_at end,
       updated_at=pg_catalog.now()
     returning request_count`, [keyHash]);
  return (row?.request_count ?? 0) <= 40;
}

export async function requestPendingBoarding(username: string, keyHash: string) {
  await query(
    `insert into public.pending_boarding_requests(normalized_username,request_key_hash)
     select $1,$2 where not exists (
       select 1 from public.pending_boarding_requests where normalized_username=$1 and request_key_hash=$2
         and status='pending' and created_at > pg_catalog.now()-interval '24 hours'
     )`, [username, keyHash]);
}

export async function readJourneyClock() {
  const [row] = await query<{ launch_at: string | null; timezone: string; journey_day: number | null }>(
    `select launch_at,timezone,public.journey_day_for(pg_catalog.now()) as journey_day from public.journey_settings where id=1`);
  return { launchAt: row?.launch_at ?? null, timezone: row?.timezone ?? "Asia/Kolkata", journeyDay: row?.journey_day ?? null };
}

export function explain(error: unknown) {
  return dbMessage(error);
}
