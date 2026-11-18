import fs from "node:fs/promises";
import { adminConfig } from "./pg-clients.mjs";
import path from "node:path";
import pg from "pg";

const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const defaultName = `nightline_feature_test_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${process.pid}`;
const name = process.env.NIGHTLINE_FEATURE_TEST_DB || defaultName;
const admin = new pg.Client(adminConfig("postgres", port));
await admin.connect();
try {
  const found = await admin.query("select 1 from pg_database where datname=$1", [name]);
  if (found.rowCount) throw new Error(`${name} already exists; refusing to reset or reuse it.`);
  await admin.query(`create database ${name}`);
} finally {
  await admin.end();
}

const app = new pg.Client(adminConfig(name, port));
await app.connect();
try {
  for (const file of [
    "0000_local_auth_stub.sql",
    "0001_identity_allocation.sql",
    "0002_content_commerce.sql",
    "0003_follower_identity_and_seats.sql",
    "0004_manychat_claims.sql",
    "0005_manual_follower_order.sql",
    "0006_follower_import_reports.sql",
  ]) {
    await app.query(await fs.readFile(path.join(process.cwd(), "supabase", "migrations", file), "utf8"));
    console.log(`${name}: ${file} applied`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Feature schema migration failed.");
  process.exitCode = 1;
} finally {
  await app.end();
}
