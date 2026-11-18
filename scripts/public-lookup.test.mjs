import assert from "node:assert/strict";

const baseUrl = (process.env.NIGHTLINE_TEST_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
async function lookup(username) {
  const response = await fetch(`${baseUrl}/api/ticket-lookup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `qa-${username}` },
    body: JSON.stringify({ username }),
  });
  return { status: response.status, body: await response.json() };
}

const known = await lookup("new_fixture_a");
const unknown = await lookup("no_such_fixture_user");
assert.deepEqual(known, unknown, "lookup must not distinguish imported from absent usernames");
assert.deepEqual(known.body, { found: false, claimRequired: true });
assert.doesNotMatch(JSON.stringify(known.body), /email|passenger_number|ticket_code|account_id/i);
console.log("Public ticket lookup privacy passed: imported and unknown usernames receive the same generic claim response.");
