import assert from "node:assert/strict";
import { adminConfig } from "./pg-clients.mjs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const database = process.env.NIGHTLINE_FEATURE_TEST_DB;
const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
if (!database || !/^nightline_feature_test_[a-z0-9_]+$/.test(database)) {
  throw new Error("Set NIGHTLINE_FEATURE_TEST_DB to a fresh, isolated feature test database.");
}
const client = new pg.Client(adminConfig(database, port));
await client.connect();
try {
  const preexisting = await client.query("select count(*)::int as count from public.passengers");
  if (preexisting.rows[0].count !== 0) throw new Error("Feature identity test requires a fresh isolated database with no passengers.");
  const importId = randomUUID();
  await client.query(`insert into public.follower_manifest_imports
    (id,file_names,content_sha256,status,total_records,unique_records)
    values($1,array['fixture.json'],repeat('a',64),'confirmed',1000,1000)`, [importId]);
  for (let rank = 1; rank <= 1000; rank += 1) {
    await client.query(`select public.assign_follower_identity($1,$2,$3,$4,$5,$6)`, [
      importId, `feature_user_${rank}`, new Date(Date.UTC(2020, 0, 1) + rank * 1000).toISOString(),
      `https://www.instagram.com/feature_user_${rank}/`, rank, 99 + rank,
    ]);
  }

  const mapping = await client.query(`select follower_rank, permanent_number, original_entitlement
    from public.passengers where follower_rank in (1,2,100,101,400,401,900,901,1000) order by follower_rank`);
  assert.deepEqual(mapping.rows, [
    { follower_rank: "1", permanent_number: "100", original_entitlement: "luxury" },
    { follower_rank: "2", permanent_number: "101", original_entitlement: "luxury" },
    { follower_rank: "100", permanent_number: "199", original_entitlement: "luxury" },
    { follower_rank: "101", permanent_number: "200", original_entitlement: "silver" },
    { follower_rank: "400", permanent_number: "499", original_entitlement: "silver" },
    { follower_rank: "401", permanent_number: "500", original_entitlement: "bronze" },
    { follower_rank: "900", permanent_number: "999", original_entitlement: "bronze" },
    { follower_rank: "901", permanent_number: "1000", original_entitlement: "regular" },
    { follower_rank: "1000", permanent_number: "1099", original_entitlement: "regular" },
  ]);
  assert.equal((await client.query("select count(*)::int as count from public.luxury_seat_inventory")).rows[0].count, 400);
  assert.equal((await client.query("select count(*)::int as count from public.luxury_seat_inventory where pool='premium'")).rows[0].count, 99);
  assert.equal((await client.query("select count(*)::int as count from public.luxury_seat_inventory where pool='follower_entitlement'")).rows[0].count, 100);
  assert.equal((await client.query("select count(*)::int as count from public.luxury_seat_inventory where pool='future_upgrade'")).rows[0].count, 201);
  const configured = await client.query(`select seat_code,price_inr,sale_approved,status from public.luxury_seat_inventory
    where seat_number in (1,2,3,4,9,10,11,49,50,99,100,199,200,400) order by seat_number`);
  assert.deepEqual(configured.rows.map(({ seat_code, price_inr, sale_approved, status }) => [seat_code, price_inr, sale_approved, status]), [
    ["L-001",999,true,"available"],["L-002",799,true,"available"],["L-003",699,true,"available"],
    ["L-004",499,true,"available"],["L-009",499,true,"available"],["L-010",null,false,"blocked"],
    ["L-011",99,true,"available"],["L-049",99,true,"available"],["L-050",49,true,"available"],
    ["L-099",49,true,"available"],["L-100",null,false,"sold"],["L-199",null,false,"sold"],
    ["L-200",null,false,"blocked"],["L-400",null,false,"blocked"],
  ]);
  assert.equal(new Set(mapping.rows.map((row) => row.permanent_number)).size, mapping.rows.length);
  assert.equal(new Set((await client.query("select permanent_number from public.passengers where permanent_number is not null")).rows.map((row) => row.permanent_number)).size, 1000);
  assert.equal((await client.query("select count(*)::int as count from public.luxury_seat_inventory where assignment_type='follower_entitlement'")).rows[0].count, 100);
  const publicPrivacy = await client.query(`select count(*)::int as listed from public.manifest`);
  assert.equal(publicPrivacy.rows[0].listed, 0, "new imports are private until a passenger opts into the public manifest");
  const privateColumns = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='manifest'`);
  assert.ok(!privateColumns.rows.some(({ column_name }) => ["email","user_id","account_user_id","verification_code"].includes(column_name)));
  const accountIds = [randomUUID(), randomUUID(), randomUUID()];
  await client.query("insert into auth.users(id,email) select id, 'feature-' || id::text || '@nightline.local' from unnest($1::uuid[]) id", [accountIds]);
  await client.query("update public.passengers set account_user_id=$1 where follower_rank=400", [accountIds[0]]);
  await client.query("update public.passengers set account_user_id=$1 where follower_rank=500", [accountIds[1]]);
  await client.query("update public.passengers set account_user_id=$1 where follower_rank=501", [accountIds[2]]);
  await client.query("update public.site_settings set value='true'::jsonb where key='payments_enabled'");
  try {
    const pool = new pg.Pool({ ...adminConfig(database, port), max: 2 });
    let winner;
    try {
      const race = await Promise.allSettled(accountIds.slice(1).map(async (accountId, index) => {
        const response = await pool.query("select * from public.reserve_luxury_seat($1,$2,$3)",
          [accountId, "L-001", `feature-race-${index}-${randomUUID()}`]);
        return { accountId, ...response.rows[0] };
      }));
      const succeeded = race.filter((result) => result.status === "fulfilled");
      assert.equal(succeeded.length, 1, `only one concurrent reservation may claim a premium seat: ${race.map((result) => result.status === "rejected" ? String(result.reason?.message) : "success").join(" | ")}`);
      winner = succeeded[0].value;
      assert.equal(winner.price_inr, 999, "the server uses the inventory price");
      const loser = race.find((result) => result.status === "rejected");
      assert.match(String(loser.reason?.message), /seat_unavailable/);

      await pool.query("select public.finalize_verified_luxury_payment($1,'test-only-mock','feature-no-real-payment')", [winner.reservation_id]);
      await pool.query("select * from public.reserve_luxury_seat($1,'L-002',$2)", [accountIds[0], `feature-499-${randomUUID()}`]);
      const [reservation] = (await pool.query("select id from public.seat_reservations where account_user_id=$1 and seat_code='L-002'", [accountIds[0]])).rows;
      await pool.query("select public.finalize_verified_luxury_payment($1,'test-only-mock','feature-passenger-499')", [reservation.id]);
      const [passenger499] = (await pool.query(`select p.permanent_number,p.follower_rank,p.original_entitlement,p.seat_class,ls.seat_code
        from public.passengers p join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
        where p.account_user_id=$1`, [accountIds[0]])).rows;
      assert.deepEqual(passenger499, { permanent_number: "499", follower_rank: "400", original_entitlement: "silver", seat_class: "luxury", seat_code: "L-002" });
      assert.equal((await pool.query("select count(*)::int as count from public.luxury_seat_inventory where passenger_id=$1 and status='sold'", [(await pool.query("select id from public.passengers where account_user_id=$1", [accountIds[0]])).rows[0].id])).rows[0].count, 1);
      assert.equal((await pool.query("select count(*)::int as count from public.luxury_seat_inventory where status='sold' and pool in ('premium','follower_entitlement')")).rows[0].count, 102);
    } finally {
      await pool.end();
    }
  } finally {
    await client.query("update public.site_settings set value='false'::jsonb where key='payments_enabled'");
  }
  console.log("Feature identity check passed: 1000 immutable identities, entitlement boundaries, 400-seat pools, and configured prices.");
} finally {
  await client.end();
}
