import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import { parse } from "pg-connection-string";

const root = process.cwd();
const migrations = [
  "0001_identity_allocation.sql",
  "0002_content_commerce.sql",
  "0003_follower_identity_and_seats.sql",
  "0004_manychat_claims.sql",
  "0005_manual_follower_order.sql",
  "0006_follower_import_reports.sql",
  "0007_lock_down_default_grants.sql",
];
const expectedHost = "aws-1-ap-south-1.pooler.supabase.com";
const expectedProject = "ytyqirvelfatkbtjuyzf";
const expectedDatabase = "postgres";
const lockId = "671443028176";

if (process.argv[2] !== "--apply") {
  throw new Error("Usage: node --env-file=.env.staging.local scripts/staging-migrate.mjs --apply");
}

const connectionString = process.env.DATABASE_URL?.trim();
const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();
const caBase64 = process.env.DATABASE_CA_CERT_BASE64?.trim();
const caPem = process.env.DATABASE_CA_CERT?.trim();
if (!connectionString || [caPath, caBase64, caPem].filter(Boolean).length !== 1) {
  throw new Error("Set DATABASE_URL and exactly one database CA certificate setting.");
}
if (/[?&](?:ssl|sslmode|sslrootcert|sslcert|sslkey)=/i.test(connectionString)) {
  throw new Error("Remove SSL parameters from DATABASE_URL; use verified driver TLS options.");
}

const parsed = parse(connectionString);
const projectRef = String(parsed.user || "").split(".").at(-1);
if (parsed.host !== expectedHost || projectRef !== expectedProject || parsed.database !== expectedDatabase) {
  throw new Error("Staging target identity check failed; no changes were made.");
}

const ca = caBase64
  ? Buffer.from(caBase64.replace(/\s/g, ""), "base64")
  : caPem
    ? Buffer.from(caPem.replace(/\\n/g, "\n"), "utf8")
    : fs.readFileSync(caPath);
if (!ca.toString("utf8").includes("-----BEGIN CERTIFICATE-----")) {
  throw new Error("The configured database CA certificate is not valid PEM data.");
}

const client = new pg.Client({
  ...parsed,
  port: 5432, // Supabase shared pooler session mode; 6543 is transaction mode.
  ssl: { ca, rejectUnauthorized: true, checkServerIdentity },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 120_000,
});

let locked = false;
let committed = false;
let freshDatabase = false;
let activeMigration = "preflight";
try {
  await client.connect();
  if (!client.connection.stream.authorized) throw new Error("TLS verification did not authorize the staging server.");
  const identity = (await client.query("select current_database() as database, current_user as role")).rows[0];
  if (identity.database !== expectedDatabase) throw new Error("Connected database identity check failed.");
  console.log(`target=verified project=${expectedProject} host=${expectedHost} database=${identity.database}`);
  console.log("connection_mode=session_pooler port=5432 tls_chain=verified hostname_verification=enabled");

  locked = (await client.query("select pg_catalog.pg_try_advisory_lock($1::bigint) as locked", [lockId])).rows[0].locked;
  if (!locked) throw new Error("Another NIGHTLINE migration runner holds the staging lock; no changes were made.");

  await client.query("begin");
  await client.query("set local lock_timeout = '5s'");
  const ledgerExists = (await client.query("select pg_catalog.to_regclass('public.schema_migrations') as ledger")).rows[0].ledger;
  let existing = [];
  if (ledgerExists) {
    existing = (await client.query("select name,checksum from public.schema_migrations order by name")).rows;
    await assertMigrationPrefix(existing);
    console.log(`preflight=verified_migration_prefix count=${existing.length}`);
  } else {
    await assertEmptyApplicationSchema(client);
    await client.query(`create table public.schema_migrations (
      name text primary key,
      checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default pg_catalog.now()
    )`);
    freshDatabase = true;
  }

  for (const name of migrations.slice(existing.length)) {
    activeMigration = name;
    const sql = fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
    await client.query(sql);
    await client.query("insert into public.schema_migrations(name, checksum) values ($1,$2)", [
      name,
      createHash("sha256").update(sql).digest("hex"),
    ]);
    console.log(`applied=${name}`);
  }

  activeMigration = "verification-before-commit";
  await verifyLedger(client);
  await verifyPostMigrationState(client, freshDatabase);
  await client.query("commit");
  committed = true;
  console.log("migration_transaction=committed");

  activeMigration = "post-commit-verification";
  await verifyLedger(client);
  await verifyPostMigrationState(client, freshDatabase);
  console.log("migration_verification=passed");
} catch (error) {
  if (!committed) await client.query("rollback").catch(() => {});
  const value = error instanceof Error ? error : new Error("Unknown migration failure");
  const code = "code" in value && typeof value.code === "string" ? value.code : "unavailable";
  console.error(`migration=failed at=${activeMigration} code=${code}`);
  console.error(`reason=${value.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database-url-redacted]")}`);
  console.error(committed
    ? "transaction=committed; post-commit verification failed and requires inspection"
    : "transaction=rolled_back; no migration changes were committed");
  process.exitCode = 1;
} finally {
  if (locked) await client.query("select pg_catalog.pg_advisory_unlock($1::bigint)", [lockId]).catch(() => {});
  await client.end().catch(() => {});
}

async function assertEmptyApplicationSchema(db) {
  const schemas = (await db.query("select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1"))
    .rows.map((row) => row.nspname);
  const allowedSchemas = ["auth", "extensions", "graphql", "graphql_public", "public", "realtime", "storage", "vault"];
  if (schemas.some((schema) => !allowedSchemas.includes(schema))) {
    throw new Error("Unexpected non-platform schema found; refusing to migrate.");
  }

  const relations = (await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')"))
    .rows.map((row) => row.relname);
  if (relations.length) throw new Error(`Public schema is not empty (${relations.length} relations); refusing to migrate.`);

  const types = Number((await db.query("select count(*)::int n from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype in ('e','c') and t.typname not like '\\_%'"))
    .rows[0].n);
  if (types) throw new Error("Public schema has custom types; refusing to migrate.");

  const functions = (await db.query("select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1"))
    .rows.map((row) => row.signature);
  if (functions.length !== 1 || functions[0] !== "rls_auto_enable()") {
    throw new Error("Unexpected public functions found; refusing to migrate.");
  }
  const hook = (await db.query("select count(*)::int n from pg_event_trigger e where e.evtname='ensure_rls' and e.evtfoid='public.rls_auto_enable()'::regprocedure"))
    .rows[0].n;
  if (Number(hook) !== 1) throw new Error("Supabase RLS event hook did not match preflight; refusing to migrate.");

  const appLedger = (await db.query("select pg_catalog.to_regclass('public.schema_migrations') as ledger")).rows[0].ledger;
  const cliLedger = (await db.query("select pg_catalog.to_regclass('supabase_migrations.schema_migrations') as ledger")).rows[0].ledger;
  if (appLedger || cliLedger) throw new Error("An existing migration ledger was found; refusing to migrate.");

  const authUsers = Number((await db.query("select count(*)::int n from auth.users")).rows[0].n);
  if (authUsers !== 0) throw new Error("Existing auth users found; refusing to migrate into a non-empty staging project.");

  const passengerObjects = Number((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname ~* '(passenger|ticket|profile|seat|follower|claim)' and n.nspname not in ('pg_catalog','information_schema','auth','storage','extensions','realtime','supabase_migrations','vault','graphql','net')"))
    .rows[0].n);
  if (passengerObjects) throw new Error("Existing passenger-related objects found; refusing to migrate.");
  console.log("preflight=empty_application_schema auth_users=0 passenger_objects=0 existing_ledgers=0");
}

async function verifyLedger(db) {
  const rows = (await db.query("select name,checksum from public.schema_migrations order by name")).rows;
  if (rows.length !== migrations.length) throw new Error(`Expected ${migrations.length} migration records; found ${rows.length}.`);
  for (let i = 0; i < migrations.length; i++) {
    const sql = fs.readFileSync(path.join(root, "supabase", "migrations", migrations[i]), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (rows[i].name !== migrations[i] || rows[i].checksum !== checksum) {
      throw new Error(`Migration ledger mismatch at ${migrations[i]}.`);
    }
    console.log(`recorded=${rows[i].name} checksum=${checksum}`);
  }
}

async function assertMigrationPrefix(rows) {
  if (rows.length > migrations.length) throw new Error("Migration ledger contains unrecognized records.");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].name !== migrations[i]) throw new Error("Migration ledger is not a valid ordered prefix.");
    const sql = fs.readFileSync(path.join(root, "supabase", "migrations", migrations[i]), "utf8");
    if (rows[i].checksum !== createHash("sha256").update(sql).digest("hex")) {
      throw new Error(`Migration checksum changed for ${migrations[i]}; refusing to continue.`);
    }
  }
}

async function verifyPostMigrationState(db, isFresh) {
  if (isFresh) return verifyInitialData(db);
  return verifyConfiguration(db);
}

async function verifyInitialData(db) {
  const data = (await db.query(`
    select
      (select count(*)::int from public.passengers) passengers,
      (select count(*)::int from public.tickets) tickets,
      (select count(*)::int from auth.users) auth_users,
      (select count(*)::int from public.seat_inventory) founding_seats,
      (select count(*)::int from public.luxury_seat_inventory) luxury_seats,
      (select value from public.site_settings where key='payments_enabled') payments_enabled
  `)).rows[0];
  if (data.passengers || data.tickets || data.auth_users || data.founding_seats !== 500 || data.luxury_seats !== 400 || data.payments_enabled !== false) {
    throw new Error("Post-migration baseline verification failed.");
  }
  console.log(`baseline=pass passengers=${data.passengers} tickets=${data.tickets} auth_users=${data.auth_users} founding_seats=${data.founding_seats} luxury_seats=${data.luxury_seats} payments_enabled=${data.payments_enabled}`);
}

async function verifyConfiguration(db) {
  const state = (await db.query("select (select count(*)::int from public.seat_inventory) founders,(select count(*)::int from public.luxury_seat_inventory) luxury,(select value from public.site_settings where key='payments_enabled') payments_enabled"))
    .rows[0];
  if (state.founders !== 500 || state.luxury !== 400 || state.payments_enabled !== false) {
    throw new Error("Post-migration configuration verification failed.");
  }
  console.log(`configuration=pass founding_seats=${state.founders} luxury_seats=${state.luxury} payments_enabled=false`);
}
