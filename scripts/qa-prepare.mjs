import fs from "node:fs/promises";
import { adminConfig } from "./pg-clients.mjs";
import path from "node:path";
import pg from "pg";

const port = Number(process.env.NIGHTLINE_PG_PORT || 54329);
const names = ["nightline_qa_ui", "nightline_qa_load"];
const admin = new pg.Client(adminConfig("postgres", port));
await admin.connect();
try {
  for (const name of names) {
    const existing = await admin.query("select 1 from pg_database where datname=$1", [name]);
    if (existing.rowCount) {
      throw new Error(`${name} already exists; refusing to reset or reuse an existing QA database.`);
    }
    await admin.query(`create database ${name}`);
    const client = new pg.Client(adminConfig(name, port));
    await client.connect();
    try {
      for (const file of ["0000_local_auth_stub.sql", "0001_identity_allocation.sql", "0002_content_commerce.sql"]) {
        const sql = await fs.readFile(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
        await client.query(sql);
        console.log(`${name}: applied ${file}`);
      }
    } finally {
      await client.end();
    }
  }
  console.log("Created two fresh, isolated local QA databases.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "QA setup failed.");
  process.exitCode = 1;
} finally {
  await admin.end();
}
