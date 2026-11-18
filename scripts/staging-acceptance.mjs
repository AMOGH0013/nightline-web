import assert from "node:assert/strict";
import fs from "node:fs";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import { parse } from "pg-connection-string";

const parsed = parse(process.env.DATABASE_URL);
assert.equal(parsed.host, "aws-1-ap-south-1.pooler.supabase.com");
assert.equal(String(parsed.user).split(".").at(-1), "ytyqirvelfatkbtjuyzf");
assert.equal(parsed.database, "postgres");
assert.doesNotMatch(process.env.DATABASE_URL, /[?&](?:ssl|sslmode|sslrootcert|sslcert|sslkey)=/i);
const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();
const caBase64 = process.env.DATABASE_CA_CERT_BASE64?.trim();
const caPem = process.env.DATABASE_CA_CERT?.trim();
assert.equal([caPath, caBase64, caPem].filter(Boolean).length, 1);
const ca = caBase64
  ? Buffer.from(caBase64.replace(/\s/g, ""), "base64")
  : caPem
    ? Buffer.from(caPem.replace(/\\n/g, "\n"), "utf8")
    : fs.readFileSync(caPath);
assert.ok(ca.toString("utf8").includes("-----BEGIN CERTIFICATE-----"));

function createClient() {
  return new pg.Client({
    ...parsed,
    port: 5432,
    ssl: { ca, rejectUnauthorized: true, checkServerIdentity },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  });
}

const client = createClient();
let transactionOpen = false;
let originalSequence;
try {
  await client.connect();
  assert.equal(client.connection.stream.authorized, true);
  const baseline = (await client.query(`
    select
      (select count(*)::int from auth.users) auth_users,
      (select count(*)::int from public.passengers) passengers,
      (select count(*)::int from public.tickets) tickets,
      (select value from public.site_settings where key='payments_enabled') payments_enabled
  `)).rows[0];
  assert.deepEqual(baseline, { auth_users: 0, passengers: 0, tickets: 0, payments_enabled: false });
  originalSequence = (await client.query("select last_value,is_called from public.stowaway_seq")).rows[0];

  await client.query("begin");
  transactionOpen = true;
  const inserted = await client.query(`
    insert into auth.users(id,aud,role,email,encrypted_password)
    select pg_catalog.gen_random_uuid(),'authenticated','authenticated',
      'nightline-qa-' || pg_catalog.md5(pg_catalog.random()::text || g.n::text || pg_catalog.clock_timestamp()::text) || '@example.invalid', ''
    from pg_catalog.generate_series(1,520) g(n)
    returning id
  `);
  assert.equal(inserted.rowCount, 520);

  const allocated = [];
  for (const user of inserted.rows) {
    const result = await client.query(`
      select kind::text,passenger_number,stowaway_number,ticket_serial,verification_code,already_registered
      from public.register_passenger($1,$2,null,true,'2026-11-18','2026-11-18')
    `, [user.id, "Staging QA Passenger"]);
    assert.equal(result.rowCount, 1);
    allocated.push({ userId: user.id, ...result.rows[0] });
  }

  const founders = allocated.filter((row) => row.kind === "founding").map((row) => row.passenger_number).sort((a, b) => a - b);
  const stowaways = allocated.filter((row) => row.kind === "stowaway").map((row) => row.stowaway_number).sort((a, b) => a - b);
  assert.equal(founders.length, 500);
  assert.deepEqual(founders, Array.from({ length: 500 }, (_, i) => i + 1));
  assert.equal(stowaways.length, 20);
  assert.deepEqual(stowaways, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(allocated.map((row) => row.ticket_serial)).size, 520);
  assert.equal(new Set(allocated.map((row) => row.verification_code)).size, 520);
  assert.ok(allocated.every((row) => row.already_registered === false));
  console.log("passenger_numbering=pass founders=500 range=1-500 stowaways=20 range=1-20 unique_tickets=520");

  const first = allocated[0];
  const duplicate = (await client.query(`
    select ticket_serial,already_registered from public.register_passenger($1,'Duplicate QA Name',null,true,'2026-11-18','2026-11-18')
  `, [first.userId])).rows[0];
  assert.equal(duplicate.already_registered, true);
  assert.equal(duplicate.ticket_serial, first.ticket_serial);
  assert.equal((await client.query("select count(*)::int n from public.passengers")).rows[0].n, 520);
  console.log("duplicate_registration=pass existing_ticket_returned no_second_passenger");

  const passenger = (await client.query("select id from public.passengers where user_id=$1", [first.userId])).rows[0].id;
  const secondPassenger = (await client.query("select id from public.passengers where user_id=$1", [allocated[1].userId])).rows[0].id;
  const suffix = first.userId.replaceAll("-", "").slice(0, 16);
  await client.query(`
    insert into public.messaging_identities(provider,provider_contact_id,instagram_scoped_id,current_username,passenger_id)
    values('manychat',$1,$2,$3,$4)
  `, [`qa-contact-${suffix}`, `qa-scope-${suffix}`, `qauser_${suffix}`, passenger]);
  await client.query("savepoint duplicate_claim");
  let duplicateContactRejected = false;
  try {
    await client.query(`
      insert into public.messaging_identities(provider,provider_contact_id,instagram_scoped_id,current_username,passenger_id)
      values('manychat',$1,$2,$3,$4)
    `, [`qa-contact-${suffix}`, `qa-other-${suffix}`, `other_${suffix}`, secondPassenger]);
  } catch (error) {
    duplicateContactRejected = error.code === "23505";
    await client.query("rollback to savepoint duplicate_claim");
  }
  assert.equal(duplicateContactRejected, true);
  await client.query("savepoint duplicate_passenger_claim");
  let duplicatePassengerRejected = false;
  try {
    await client.query(`
      insert into public.messaging_identities(provider,provider_contact_id,instagram_scoped_id,current_username,passenger_id)
      values('manychat',$1,$2,$3,$4)
    `, [`qa-other-contact-${suffix}`, `qa-other-scope-${suffix}`, `another_${suffix}`, passenger]);
  } catch (error) {
    duplicatePassengerRejected = error.code === "23505";
    await client.query("rollback to savepoint duplicate_passenger_claim");
  }
  assert.equal(duplicatePassengerRejected, true);
  console.log("duplicate_claims=pass provider_contact_and_passenger_uniqueness_enforced");

  await client.query("rollback");
  transactionOpen = false;
  await client.query("select pg_catalog.setval('public.stowaway_seq'::regclass,$1,$2)", [originalSequence.last_value, originalSequence.is_called]);
  const after = (await client.query(`
    select
      (select count(*)::int from auth.users) auth_users,
      (select count(*)::int from public.passengers) passengers,
      (select count(*)::int from public.tickets) tickets,
      (select count(*)::int from public.messaging_identities) messaging_identities,
      (select value from public.site_settings where key='payments_enabled') payments_enabled
  `)).rows[0];
  assert.deepEqual(after, { auth_users: 0, passengers: 0, tickets: 0, messaging_identities: 0, payments_enabled: false });
  const sequenceAfter = (await client.query("select last_value,is_called from public.stowaway_seq")).rows[0];
  assert.equal(String(sequenceAfter.last_value), String(originalSequence.last_value));
  assert.equal(sequenceAfter.is_called, originalSequence.is_called);
  console.log("transaction_cleanup=pass synthetic_rows=0 stowaway_sequence_restored=true");

  const seatBefore = (await client.query("select status from public.luxury_seat_inventory where seat_code='L-001'")).rows[0].status;
  assert.equal(seatBefore, "available");
  const attempts = await Promise.all([1, 2].map(async () => {
    const contender = createClient();
    try {
      await contender.connect();
      assert.equal(contender.connection.stream.authorized, true);
      await contender.query("select * from public.reserve_luxury_seat($1,'L-001',$2)", ["00000000-0000-4000-8000-000000000001", `qa-reservation-${Math.random().toString(16).slice(2, 12)}`]);
      return "unexpected_success";
    } catch (error) {
      return error.message === "payments_disabled" ? "payments_disabled" : `unexpected_${error.code || error.name}`;
    } finally {
      await contender.end().catch(() => {});
    }
  }));
  assert.deepEqual(attempts, ["payments_disabled", "payments_disabled"]);
  assert.equal((await client.query("select status from public.luxury_seat_inventory where seat_code='L-001'")).rows[0].status, "available");
  assert.equal((await client.query("select count(*)::int n from public.seat_reservations")).rows[0].n, 0);
  assert.equal((await client.query("select value from public.site_settings where key='payments_enabled'")).rows[0].value, false);
  console.log("concurrent_reservation_safety=pass contenders=2 fail_closed=payments_disabled payments_setting=unchanged");
  console.log("concurrent_eligible_reservation_race=not_run payments_remain_disabled");
} catch (error) {
  const value = error instanceof Error ? error : new Error("Unknown acceptance failure");
  const code = "code" in value && typeof value.code === "string" ? value.code : "unavailable";
  console.error(`acceptance=failed code=${code} reason=${value.message}`);
  process.exitCode = 1;
} finally {
  if (transactionOpen) await client.query("rollback").catch(() => {});
  if (originalSequence) {
    await client.query("select pg_catalog.setval('public.stowaway_seq'::regclass,$1,$2)", [originalSequence.last_value, originalSequence.is_called]).catch(() => {});
  }
  await client.end().catch(() => {});
}
