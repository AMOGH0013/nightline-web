import assert from "node:assert/strict";

const base = process.env.NIGHTLINE_TEST_URL || "http://127.0.0.1:3000";
for (const path of ["/api/register", "/api/profile", "/api/vote", "/api/admin"]) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401, `${path} must reject unauthenticated requests`);
}
console.log("HTTP checks passed (registration, profile, voting and admin reject unauthenticated requests).");
