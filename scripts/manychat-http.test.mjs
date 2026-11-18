import assert from "node:assert/strict";
import { adminConfig } from "./pg-clients.mjs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const database = process.env.NIGHTLINE_MANYCHAT_TEST_DB;
const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const baseUrl = (process.env.NIGHTLINE_TEST_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
if (!database || !/^nightline_feature_test_[a-z0-9_]+$/.test(database)) throw new Error("Set NIGHTLINE_MANYCHAT_TEST_DB to a fresh isolated feature database.");
if (!secret || Buffer.byteLength(secret) < 32) throw new Error("Set a test-only MANYCHAT_WEBHOOK_SECRET with at least 32 characters.");

const client = new pg.Client(adminConfig(database, port));
await client.connect();
const username = `mc${Date.now()}`;
const importId = randomUUID();
let rank = 0;
let permanentNumber = 0;
try {
  const [latest] = (await client.query("select coalesce(max(follower_rank),0)::int as rank from public.passengers")).rows;
  rank = latest.rank + 1;
  permanentNumber = 99 + rank;
  await client.query(`insert into public.follower_manifest_imports(id,file_names,content_sha256,status,total_records,unique_records)
    values($1,array['synthetic-test.json'],repeat('b',64),'confirmed',1,1)`, [importId]);
  await client.query(`select public.assign_follower_identity($1,$2,$3,$4,$5,$6)`, [importId,username,new Date().toISOString(),`https://www.instagram.com/${username}/`,rank,permanentNumber]);
} finally { await client.end(); }

const endpoint = `${baseUrl}/api/webhooks/manychat/claim`;
const payload = { contact_id: `test-contact-${Date.now()}`, instagram_scoped_id: `test-igsid-${Date.now()}`, instagram_username: username };
const unauthorized = await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer wrong"},body:JSON.stringify(payload)});
assert.equal(unauthorized.status,401,"reject unauthenticated request");
const invalid = await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${secret}`},body:JSON.stringify({contact_id:payload.contact_id})});
assert.equal(invalid.status,400,"validate payload");
const call = (body) => fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${secret}`},body:JSON.stringify(body)});
const firstResponse = await call(payload); assert.equal(firstResponse.status,200);
const first = await firstResponse.json();
const expectedClass = permanentNumber <= 199 ? "luxury" : permanentNumber <= 499 ? "silver" : permanentNumber <= 999 ? "bronze" : "regular";
const expectedSeat = rank <= 100 ? `L-${String(99 + rank).padStart(3,"0")}` : null;
assert.equal(first.claimed,true); assert.equal(first.passenger_number,permanentNumber); assert.equal(first.original_class,expectedClass); assert.equal(first.seat,expectedSeat);
const duplicateResponse = await call(payload); assert.equal(duplicateResponse.status,200);
const duplicate = await duplicateResponse.json();
assert.equal(duplicate.already_claimed,true); assert.equal(duplicate.ticket_url,first.ticket_url);
const renamedResponse = await call({...payload,instagram_username:`${username}_renamed`}); assert.equal(renamedResponse.status,200);
const renamed = await renamedResponse.json(); assert.equal(renamed.passenger_number,permanentNumber); assert.equal(renamed.ticket_url,first.ticket_url);
const ticketResponse = await fetch(renamed.ticket_url); assert.equal(ticketResponse.status,200);
const ticketHtml = await ticketResponse.text();
const verifyClient = new pg.Client(adminConfig(database, port));
await verifyClient.connect();
const [ticketRecord] = (await verifyClient.query(`select t.serial,p.permanent_number from public.passengers p join public.profiles pr on pr.id=p.user_id
  join public.tickets t on t.passenger_id=p.id where pr.instagram_handle=$1`, [`${username}_renamed`])).rows;
await verifyClient.end();
assert.equal(Number(ticketRecord?.permanent_number), permanentNumber);
assert.ok(ticketRecord?.serial && ticketHtml.includes(ticketRecord.serial), "claim link renders the claimed passenger's ticket serial");
assert.ok(ticketHtml.includes("Original entitlement")); if (expectedSeat) assert.ok(ticketHtml.includes(expectedSeat));
const missingResponse = await call({...payload,contact_id:"unknown-contact",instagram_scoped_id:"unknown-igsid",instagram_username:"no_such_imported_user"});
assert.equal((await missingResponse.json()).claimed,false,"unknown username does not issue a ticket");
console.log("Manychat local simulator passed: auth rejection, schema validation, claim, idempotent retry, stable-ID username update, private ticket URL render, and unknown identity.");
