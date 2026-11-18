import assert from "node:assert/strict";
import { adminConfig } from "./pg-clients.mjs";
import pg from "pg";

const database = process.env.NIGHTLINE_SECURITY_TEST_DB;
if (!database || !/^nightline_feature_test_[a-z0-9_]+$/.test(database)) {
  throw new Error("Set NIGHTLINE_SECURITY_TEST_DB to an isolated feature test database.");
}
const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const client = new pg.Client(adminConfig(database, port));
await client.connect();
try {
  const checks = await client.query(`
    select
      has_table_privilege('anon', 'public.profiles', 'select') as anon_profiles,
      has_table_privilege('authenticated', 'public.tickets', 'select') as auth_tickets,
      has_table_privilege('anon', 'public.manifest', 'select') as anon_manifest,
      has_function_privilege('anon', 'public.register_passenger(uuid,text,text,boolean,text,text)', 'execute') as anon_register,
      has_function_privilege('authenticated', 'public.register_passenger(uuid,text,text,boolean,text,text)', 'execute') as auth_register,
      has_function_privilege('anon', 'public.verify_ticket(text)', 'execute') as anon_verify
  `);
  const [row] = checks.rows;
  assert.equal(row.anon_profiles, false, "anonymous users cannot read private profiles");
  assert.equal(row.auth_tickets, true, "authenticated users may read their tickets subject to RLS");
  assert.equal(row.anon_manifest, true, "anonymous users can read the privacy-filtered manifest");
  assert.equal(row.anon_register, false, "anonymous users cannot allocate passengers");
  assert.equal(row.auth_register, false, "authenticated users cannot allocate passengers directly");
  assert.equal(row.anon_verify, true, "ticket verification is public by possession of its code");

  const columns = await client.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'manifest'
  `);
  const names = new Set(columns.rows.map(({ column_name }) => column_name));
  for (const privateColumn of ["user_id", "verification_code", "email", "id"]) {
    assert.equal(names.has(privateColumn), false, `manifest does not expose ${privateColumn}`);
  }
  console.log("Security checks passed (6 privilege checks and manifest privacy schema).");
} finally {
  await client.end();
}
