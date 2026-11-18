import assert from "node:assert/strict";
import { adminConfig, appConfig } from "./pg-clients.mjs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const admin = new pg.Client(adminConfig("nightline_race", port));
await admin.connect();
const ids = Array.from({ length: 24 }, () => randomUUID());
try {
  for (const id of ids) {
    await admin.query("insert into auth.users (id,email) values ($1,$2)", [id, `race-${id}@nightline.local`]);
  }
  const pool = new pg.Pool({
    ...appConfig("nightline_race", port),
    max: 24,
  });
  try {
    const allocated = await Promise.all(ids.map(async (id) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
        await client.query("select set_config('request.jwt.claim.role','',true)");
        const result = await client.query(
          "select kind, passenger_number, stowaway_number, ticket_serial from public.register_passenger($1,$2,null,true,'2026-11-18','2026-11-18')",
          [id, `Race ${id.slice(0, 8)}`],
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
    assert.equal(allocated.length, ids.length);
    const serials = new Set(allocated.map((item) => item.ticket_serial));
    assert.equal(serials.size, ids.length, "every concurrent registration receives a unique ticket serial");
    const numbers = allocated.filter((item) => item.passenger_number !== null).map((item) => item.passenger_number);
    assert.equal(new Set(numbers).size, numbers.length, "founding seat numbers are never duplicated");
    assert.ok(allocated.every((item) => item.kind === "founding"));
    console.log(`Concurrency check passed (${ids.length} simultaneous unique allocations).`);
  } finally {
    await pool.end();
  }
} finally {
  await admin.query("delete from auth.users where id = any($1::uuid[])", [ids]);
  await admin.end();
}
