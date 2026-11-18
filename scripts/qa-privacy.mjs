import assert from "node:assert/strict";
import { adminConfig } from "./pg-clients.mjs";
import pg from "pg";

const database = process.env.NIGHTLINE_SECURITY_TEST_DB;
const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
if (!database || !( /^nightline_feature_test_[a-z0-9_]+$/.test(database) || database === "nightline_qa_ui")) {
  throw new Error("Set NIGHTLINE_SECURITY_TEST_DB to an isolated feature test database or the read-only legacy nightline_qa_ui fixture.");
}
const client = new pg.Client(adminConfig(database, port));
await client.connect();
try {
  const users = await client.query("select u.id from auth.users u join public.profiles p on p.id=u.id order by u.created_at limit 2");
  assert.ok(users.rowCount >= 2, "QA database has two separate test accounts");
  const [owner, other] = users.rows;
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [owner.id]);
    const ownProfiles = await client.query("select id from public.profiles where id=$1", [owner.id]);
    const otherProfiles = await client.query("select id from public.profiles where id=$1", [other.id]);
    const otherTickets = await client.query("select t.id from public.tickets t join public.passengers p on p.id=t.passenger_id where p.user_id=$1", [other.id]);
    assert.equal(ownProfiles.rowCount, 1, "passenger can read own profile");
    assert.equal(otherProfiles.rowCount, 0, "passenger cannot read another profile");
    assert.equal(otherTickets.rowCount, 0, "passenger cannot read another passenger ticket");
  } finally {
    await client.query("rollback");
  }

  const catalog = await client.query(`
    select
      (select value::boolean from public.site_settings where key='payments_enabled') as payments_enabled,
      (select count(*)::int from public.products where enabled and price_inr > 0) as enabled_paid_products,
      (select count(*)::int from public.role_definitions where enabled and key in ('conductor','driver')) as enabled_unresolved_roles
  `);
  assert.equal(catalog.rows[0].payments_enabled, false, "payment setting remains disabled");
  assert.equal(catalog.rows[0].enabled_paid_products, 0, "no paid product is enabled");
  assert.equal(catalog.rows[0].enabled_unresolved_roles, 0, "Conductor and Driver roles remain disabled");
  console.log("QA privacy/payment checks passed (cross-account RLS and disabled commerce settings).");
} finally {
  await client.end();
}
