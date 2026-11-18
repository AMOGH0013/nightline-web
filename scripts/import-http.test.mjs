import assert from "node:assert/strict";
import fs from "node:fs/promises";

const baseUrl = (process.env.NIGHTLINE_TEST_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const email = process.env.NIGHTLINE_IMPORT_TEST_ADMIN || "conductor@nightline.local";
const zipPath = new URL("../qa-artifacts/import-ui-fixture/followers-export.zip", import.meta.url);
const zip = await fs.readFile(zipPath);

const start = await fetch(`${baseUrl}/api/auth/local/start`, { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email}) });
assert.equal(start.status,200,"local admin sign-in start");
const { devCode } = await start.json(); assert.match(devCode,/^\d{6}$/);
const verify = await fetch(`${baseUrl}/api/auth/local/verify`, { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,code:devCode}) });
assert.equal(verify.status,200,"local admin sign-in verification");
const cookie = verify.headers.get("set-cookie")?.split(";")[0]; assert.match(cookie ?? "",/^nl_session=/);
async function previewZip() {
  const form = new FormData(); form.append("files",new File([zip],"followers-export.zip",{type:"application/zip"}));
  const response = await fetch(`${baseUrl}/api/admin/followers/preview`,{method:"POST",headers:{cookie},body:form});
  const payload = await response.json(); assert.equal(response.status,200,payload.message ?? payload.error);
  return payload;
}
const preview = await previewZip();
assert.equal(preview.counts.total,2); assert.equal(preview.counts.unique,2); assert.equal(preview.counts.new,2); assert.equal(preview.counts.lateHistorical,0);
assert.equal(preview.counts.malformed,0); assert.equal(preview.counts.missingTimestamps,0);
assert.ok(preview.preview.every((row) => row.seat?.startsWith("L-")));
const confirmed = await fetch(`${baseUrl}/api/admin/followers/confirm`,{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({importId:preview.importId,approveLateHistorical:true})});
const confirmationBody = await confirmed.json(); assert.equal(confirmed.status,200,JSON.stringify(confirmationBody)); const result = confirmationBody; assert.equal(result.allocated,2); assert.equal(result.existingRetained,0);
const csvResponse = await fetch(`${baseUrl}/api/admin/followers/export?importId=${preview.importId}&format=csv`,{headers:{cookie}});
assert.equal(csvResponse.status,200); const csv = await csvResponse.text(); assert.match(csv,/passenger_number,instagram_username,follower_rank/); assert.match(csv,/new_fixture_a/); assert.doesNotMatch(csv,/verification_code|account_user_id|@example\.com/i);
const jsonResponse = await fetch(`${baseUrl}/api/admin/followers/export?importId=${preview.importId}&format=json`,{headers:{cookie}});
assert.equal(jsonResponse.status,200); const report = await jsonResponse.json(); assert.equal(report.records.length,2); assert.equal(report.records[0].permanent_number,100);
const repeated = await previewZip();
assert.equal(repeated.counts.existing,2,"repeat import recognizes prior identities"); assert.equal(repeated.counts.new,0,"repeat import does not propose duplicate identities");
console.log("Follower import local HTTP test passed: synthetic ZIP upload, admin authentication, preview, confirmation, report export, and repeat-import idempotency.");
