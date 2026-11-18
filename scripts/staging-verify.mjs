import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import { parse } from "pg-connection-string";

const root = process.cwd();
const migrationNames = [
  "0001_identity_allocation.sql",
  "0002_content_commerce.sql",
  "0003_follower_identity_and_seats.sql",
  "0004_manychat_claims.sql",
  "0005_manual_follower_order.sql",
  "0006_follower_import_reports.sql",
];
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

const client = new pg.Client({
  ...parsed,
  port: 5432,
  ssl: { ca, rejectUnauthorized: true, checkServerIdentity },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  assert.equal(client.connection.stream.authorized, true);
  const ledger = (await client.query("select name,checksum from public.schema_migrations order by name")).rows;
  assert.deepEqual(ledger.map((row) => row.name), migrationNames);
  for (let i = 0; i < migrationNames.length; i++) {
    const sql = fs.readFileSync(path.join(root, "supabase", "migrations", migrationNames[i]), "utf8");
    assert.equal(ledger[i].checksum, createHash("sha256").update(sql).digest("hex"));
  }
  console.log(`migration_ledger=pass count=${ledger.length} checksums=match`);

  const migrationTables = migrationNames.flatMap((name) => {
    const sql = fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
    return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][\w]*)/gi)].map((match) => match[1]);
  });
  const expectedTables = [...migrationTables, "schema_migrations"].sort();
  const actualTables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename"))
    .rows.map((row) => row.tablename);
  assert.deepEqual(actualTables, expectedTables);
  console.log(`tables=pass count=${actualTables.length}`);

  const requiredConstraints = [
    "passengers_user_id_key",
    "passengers_passenger_number_key",
    "passengers_stowaway_number_key",
    "tickets_serial_key",
    "tickets_verification_code_key",
    "messaging_identities_provider_provider_contact_id_key",
    "messaging_identities_provider_passenger_id_key",
    "follower_import_records_pkey",
  ];
  const constraintNames = (await client.query("select conname from pg_constraint where connamespace='public'::regnamespace"))
    .rows.map((row) => row.conname);
  for (const name of requiredConstraints) assert.ok(constraintNames.includes(name), `missing unique constraint ${name}`);
  const importPkColumns = (await client.query(`
    select a.attname
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.conrelid='public.follower_import_records'::regclass and c.contype='p'
    order by k.ord
  `)).rows.map((row) => row.attname);
  assert.deepEqual(importPkColumns, ["import_id", "normalized_username"]);
  const fkCount = Number((await client.query("select count(*)::int n from pg_constraint where connamespace='public'::regnamespace and contype='f'"))
    .rows[0].n);
  assert.ok(fkCount > 0);
  const uniqueConstraintCount = Number((await client.query("select count(*)::int n from pg_constraint where connamespace='public'::regnamespace and contype in ('p','u')"))
    .rows[0].n);
  console.log(`constraints=pass foreign_keys=${fkCount} unique_constraints=${uniqueConstraintCount} total=${constraintNames.length}`);

  const indexCounts = (await client.query("select count(*)::int total,count(*) filter(where i.indisunique)::int unique_count from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'"))
    .rows[0];
  assert.ok(indexCounts.total > 0 && indexCounts.unique_count > 0);
  console.log(`indexes=pass total=${indexCounts.total} unique=${indexCounts.unique_count}`);

  const rls = (await client.query("select count(*)::int total,count(*) filter(where not c.relrowsecurity)::int disabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')"))
    .rows[0];
  assert.equal(rls.total, actualTables.length);
  assert.equal(rls.disabled, 0);
  const policyCount = Number((await client.query("select count(*)::int n from pg_policies where schemaname='public'"))
    .rows[0].n);
  assert.ok(policyCount >= 10);
  const keyPolicies = (await client.query("select tablename,policyname from pg_policies where schemaname='public' and policyname in ('profiles_select_own','profiles_update_own','passengers_select_own','tickets_select_own','votes_select_own') order by policyname"))
    .rows.map((row) => `${row.tablename}.${row.policyname}`);
  assert.equal(keyPolicies.length, 5);
  console.log(`rls=pass tables=${rls.total} policies=${policyCount} key_owner_policies=5`);

  const privileges = (await client.query(`
    select
      has_table_privilege('anon','public.passengers','select') as anon_passengers,
      has_table_privilege('authenticated','public.passengers','select') as auth_passengers,
      has_table_privilege('anon','public.manifest','select') as anon_manifest,
      has_function_privilege('anon','public.register_passenger(uuid,text,text,boolean,text,text)','execute') as anon_register,
      has_function_privilege('authenticated','public.register_passenger(uuid,text,text,boolean,text,text)','execute') as auth_register,
      has_function_privilege('service_role','public.register_passenger(uuid,text,text,boolean,text,text)','execute') as service_register,
      has_function_privilege('anon','public.reserve_luxury_seat(uuid,text,text)','execute') as anon_reserve,
      has_function_privilege('authenticated','public.reserve_luxury_seat(uuid,text,text)','execute') as auth_reserve,
      has_function_privilege('service_role','public.reserve_luxury_seat(uuid,text,text)','execute') as service_reserve
  `)).rows[0];
  assert.equal(privileges.anon_passengers, false);
  assert.equal(privileges.auth_passengers, true);
  assert.equal(privileges.anon_manifest, true);
  assert.equal(privileges.anon_register, false);
  assert.equal(privileges.auth_register, false);
  assert.equal(privileges.service_register, true);
  assert.equal(privileges.anon_reserve, false);
  assert.equal(privileges.auth_reserve, false);
  assert.equal(privileges.service_reserve, true);
  const manifestColumns = (await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='manifest'"))
    .rows.map((row) => row.column_name);
  for (const privateColumn of ["email", "user_id", "account_user_id", "verification_code", "token_hash"]) {
    assert.ok(!manifestColumns.includes(privateColumn), `private column leaked by manifest: ${privateColumn}`);
  }
  console.log("permissions=pass manifest_private_columns=absent protected_functions=restricted");

  const functions = (await client.query("select p.proname,p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"))
    .rows;
  for (const name of ["register_passenger", "assign_follower_identity", "reserve_luxury_seat", "verify_passenger_ticket", "cast_vote"]) {
    assert.ok(functions.some((fn) => fn.proname === name), `missing function ${name}`);
  }
  const safeSearchPaths = ["search_path=\"\"", "search_path=pg_catalog"];
  const unsafeDefiners = functions.filter((fn) => fn.prosecdef && !safeSearchPaths.includes(fn.config));
  assert.deepEqual(unsafeDefiners, []);
  console.log(`functions=pass public_count=${functions.length} unsafe_security_definers=0`);

  const inventory = (await client.query(`
    select count(*)::int total,
      count(*) filter(where pool='premium')::int premium,
      count(*) filter(where pool='follower_entitlement')::int follower_entitlement,
      count(*) filter(where pool='future_upgrade')::int future_upgrade,
      count(*) filter(where status='blocked')::int blocked
    from public.luxury_seat_inventory
  `)).rows[0];
  assert.deepEqual(inventory, { total: 400, premium: 99, follower_entitlement: 100, future_upgrade: 201, blocked: 202 });
  const baseline = (await client.query(`
    select (select count(*)::int from public.passengers) passengers,
      (select count(*)::int from public.tickets) tickets,
      (select count(*)::int from auth.users) auth_users,
      (select count(*)::int from public.seat_inventory) founding_seats,
      (select value from public.site_settings where key='payments_enabled') payments_enabled,
      (select enabled from public.role_definitions where key='conductor') conductor_enabled,
      (select enabled from public.role_definitions where key='driver') driver_enabled
  `)).rows[0];
  assert.equal(baseline.passengers, 0);
  assert.equal(baseline.tickets, 0);
  assert.equal(baseline.auth_users, 0);
  assert.equal(baseline.founding_seats, 500);
  assert.equal(baseline.payments_enabled, false);
  assert.equal(baseline.conductor_enabled, false);
  assert.equal(baseline.driver_enabled, false);
  console.log(`luxury_inventory=pass ${JSON.stringify(inventory)}`);
  console.log("initial_data=pass passenger_rows=0 ticket_rows=0 auth_users=0 payments=false conductor=false driver=false");
} catch (error) {
  const value = error instanceof Error ? error : new Error("Unknown verification failure");
  const code = "code" in value && typeof value.code === "string" ? value.code : "unavailable";
  console.error(`verification=failed code=${code} reason=${value.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
