import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

const source = await fs.readFile(new URL("../src/lib/follower-import-format.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseInstagramFollowerFiles } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const parsed = parseInstagramFollowerFiles([
  { name: "followers_1.json", text: JSON.stringify([
    { string_list_data: [{ value: "Second", href: "https://www.instagram.com/Second/", timestamp: 1700000000 }] },
    { string_list_data: [{ value: "First", href: "https://www.instagram.com/First/", timestamp: 1700000000 }] },
    { string_list_data: [{ value: "AlsoTied", timestamp: 1700000000 }] },
    { string_list_data: [{ value: "second", timestamp: 1690000000 }] },
    { string_list_data: [{ value: "NoTimestamp" }] },
    { string_list_data: [{ value: "Bad Name" }] },
  ]) },
  { name: "followers_2.json", text: JSON.stringify({ relationships_followers: [
    { string_list_data: [{ value: "FIRST", timestamp: 1700000000 }] },
  ] }) },
]);
assert.equal(parsed.totalRecords, 7);
assert.equal(parsed.duplicateRecords, 2);
assert.equal(parsed.malformedRecords, 1);
assert.equal(parsed.missingTimestamps, 1);
assert.equal(parsed.tiedTimestampRecords, 2);
assert.deepEqual(parsed.records.map(({ username }) => username), ["second", "first", "alsotied", "notimestamp"]);
assert.equal(parsed.records[0].followedAt, new Date(1690000000 * 1000).toISOString());
assert.equal(parsed.records[3].followedAt, null);

const invalid = parseInstagramFollowerFiles([{ name: "bad.json", text: "{" }]);
assert.equal(invalid.malformedRecords, 1);
assert.equal(invalid.records.length, 0);
console.log("Follower parser checks passed: Instagram JSON variants, normalization, duplicate/malformed/missing records, and stable equal-time order.");
