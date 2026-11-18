import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const port = 54329;
const root = process.cwd();
const databaseDir = path.join(root, ".pgdata");
const adminPasswordFile = path.join(databaseDir, "local-admin-password");
const envFile = path.join(root, ".env.local");
const fresh = !fs.existsSync(path.join(databaseDir, "PG_VERSION"));
let adminPassword = process.env.NIGHTLINE_PG_ADMIN_PASSWORD?.trim();
if (!adminPassword && fs.existsSync(adminPasswordFile)) {
  adminPassword = fs.readFileSync(adminPasswordFile, "utf8").trim();
}
if (!adminPassword && fresh) adminPassword = randomBytes(32).toString("base64url");
if (!adminPassword) {
  throw new Error("Set NIGHTLINE_PG_ADMIN_PASSWORD for this existing local cluster; no database was changed.");
}

const server = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: adminPassword,
  port,
  persistent: true,
  onLog: () => {},
  onError: (error) => console.error("Embedded PostgreSQL error:", error?.code || "unknown"),
});

if (fresh) {
  console.log("Initialising local PostgreSQL cluster…");
  await server.initialise();
}
await server.start();
if (!fs.existsSync(adminPasswordFile)) {
  fs.writeFileSync(adminPasswordFile, `${adminPassword}\n`, { flag: "wx" });
}
console.log(`PostgreSQL listening on 127.0.0.1:${port}`);

for (const name of ["nightline", "nightline_test", "nightline_race"]) {
  const probe = new pg.Client(adminConfig("postgres"));
  await probe.connect();
  const existing = await probe.query("select 1 from pg_database where datname = $1", [name]);
  if (existing.rowCount === 0) await probe.query(`create database ${name}`);
  await probe.end();
  await migrate(name);
}

let appPassword = fs.existsSync(envFile) ? readLoopbackAppPassword(envFile) : randomBytes(32).toString("base64url");
if (fresh && appPassword) {
  const admin = new pg.Client(adminConfig("postgres"));
  await admin.connect();
  try {
    const { rows } = await admin.query("select pg_catalog.format('alter role nightline_app password %L', $1) as sql", [appPassword]);
    await admin.query(rows[0].sql);
  } finally {
    await admin.end();
  }
}
writeEnv(appPassword);
console.log("App database: nightline");
console.log("Security tests: nightline_test");
console.log("Concurrency tests: nightline_race");
console.log("Leave this process running, then start the site with npm run dev.");

setInterval(() => {}, 1 << 30);

function adminConfig(database) {
  return { host: "127.0.0.1", port, database, user: "postgres", password: adminPassword };
}

async function migrate(database) {
  const client = new pg.Client(adminConfig(database));
  await client.connect();
  try {
    await client.query(`create table if not exists public.schema_migrations (
      name text primary key, applied_at timestamptz not null default now()
    )`);
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const state = await client.query("select to_regclass('public.passengers') as passengers, to_regclass('public.products') as products");
    const baseline = await client.query("select count(*)::int as count from public.schema_migrations");
    if (!state.rows[0].passengers && baseline.rows[0].count === 0) {
      for (const name of migrations) await applyMigration(client, database, name);
    } else {
      // Databases created before migration tracking already contain 0000–0002.
      if (baseline.rows[0].count === 0) {
        const applied = ["0000_local_auth_stub.sql", "0001_identity_allocation.sql"];
        if (state.rows[0].products) applied.push("0002_content_commerce.sql");
        for (const name of applied) await client.query("insert into public.schema_migrations(name) values($1) on conflict do nothing", [name]);
      }
      const recorded = new Set((await client.query("select name from public.schema_migrations")).rows.map((row) => row.name));
      for (const name of migrations) if (!recorded.has(name)) await applyMigration(client, database, name);
    }
    console.log(`  ${database}: migrations current`);
  } finally {
    await client.end();
  }
}

async function applyMigration(client, database, name) {
  const sql = fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into public.schema_migrations(name) values($1)", [name]);
    await client.query("commit");
    console.log(`  ${database}: applied ${name}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function writeEnv(password) {
  if (fs.existsSync(envFile)) return;
  if (!password) throw new Error("A local app role password could not be prepared; existing .env.local was left untouched.");
  const secret = randomBytes(24).toString("hex");
  const databaseUrl = new URL(`postgres://127.0.0.1:${port}/nightline`);
  databaseUrl.username = "nightline_app";
  databaseUrl.password = password;
  fs.writeFileSync(envFile, [
    "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
    `DATABASE_URL=${databaseUrl.toString()}`,
    `LOCAL_SESSION_SECRET=${secret}`,
    "LOCAL_ADMIN_EMAILS=conductor@nightline.local",
    "",
  ].join("\n"), { flag: "wx" });
  console.log("Wrote .env.local");
}

function readLoopbackAppPassword(file) {
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((value) => /^\s*DATABASE_URL\s*=/.test(value));
  const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return "";
    return decodeURIComponent(url.password);
  } catch {
    return "";
  }
}
