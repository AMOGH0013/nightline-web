import assert from "node:assert/strict";
import { adminConfig, appConfig } from "./pg-clients.mjs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const database = "nightline_qa_load";
const admin = new pg.Client(adminConfig(database, port));
await admin.connect();
const ids = Array.from({ length: 520 }, () => randomUUID());
let pool;
try {
  await admin.query(
    "insert into auth.users (id,email) select id, 'qa-load-' || id::text || '@nightline.local' from unnest($1::uuid[]) as id",
    [ids],
  );
  pool = new pg.Pool({
    ...appConfig(database, port),
    max: 64,
  });
  const started = Date.now();
  const allocated = await Promise.all(ids.map(async (id) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
      await client.query("select set_config('request.jwt.claim.role','',true)");
      const result = await client.query(
        "select kind, passenger_number, stowaway_number, ticket_serial, verification_code, already_registered from public.register_passenger($1,$2,null,true,'2026-11-18','2026-11-18')",
        [id, `Load ${id.slice(0, 8)}`],
      );
      await client.query("commit");
      return result.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }));

  assert.equal(allocated.length, 520);
  assert.ok(allocated.every((row) => !row.already_registered));
  const founders = allocated.filter((row) => row.kind === "founding");
  const stowaways = allocated.filter((row) => row.kind === "stowaway");
  assert.equal(founders.length, 500);
  assert.equal(stowaways.length, 20);
  assert.deepEqual(founders.map((row) => row.passenger_number).sort((a, b) => a - b), Array.from({ length: 500 }, (_, i) => i + 1));
  assert.deepEqual(stowaways.map((row) => row.stowaway_number).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(allocated.map((row) => row.ticket_serial)).size, 520);
  assert.equal(new Set(allocated.map((row) => row.verification_code)).size, 520);

  const [lastFounder] = await admin.query(`
    select p.special_role, t.serial
    from public.passengers p join public.tickets t on t.passenger_id=p.id
    where p.passenger_number=500
  `).then((result) => result.rows);
  assert.equal(lastFounder.special_role, null, "Passenger 500 has no unresolved role assigned");
  const persisted = await admin.query(`
    select count(*)::int as passengers, count(distinct t.serial)::int as tickets
    from public.passengers p join public.tickets t on t.passenger_id=p.id
  `);
  assert.deepEqual(persisted.rows[0], { passengers: 520, tickets: 520 });
  console.log(`520-way registration passed: 500 founders, 20 stowaways, unique tickets, Passenger 500 unassigned (${Date.now() - started} ms).`);
} finally {
  await pool?.end();
  await admin.end();
}
