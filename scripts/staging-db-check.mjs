import fs from "node:fs";
import { checkServerIdentity } from "node:tls";
import pg from "pg";
import { parse } from "pg-connection-string";

const connectionString = process.env.DATABASE_URL?.trim();
const caPath = process.env.DATABASE_CA_CERT_PATH?.trim();
const caBase64 = process.env.DATABASE_CA_CERT_BASE64?.trim();
const caPem = process.env.DATABASE_CA_CERT?.trim();
const caSourceCount = [caPath, caBase64, caPem].filter(Boolean).length;
if (!connectionString || caSourceCount !== 1) {
  throw new Error("Set DATABASE_URL and exactly one database CA certificate setting in the staging environment.");
}

if (/[?&](?:ssl|sslmode|sslrootcert|sslcert|sslkey)=/i.test(connectionString)) {
  throw new Error("Remove SSL parameters from DATABASE_URL; SSL is configured through the pg TLS options.");
}

const parsed = parse(connectionString);
const expectedHost = "aws-1-ap-south-1.pooler.supabase.com";
if (parsed.host !== expectedHost) {
  throw new Error(`Unexpected staging database host: ${parsed.host || "missing"}`);
}

if (caPath && !fs.statSync(caPath).isFile()) throw new Error("DATABASE_CA_CERT_PATH does not point to a certificate file.");
const ca = caBase64
  ? Buffer.from(caBase64.replace(/\s/g, ""), "base64")
  : caPem
    ? Buffer.from(caPem.replace(/\\n/g, "\n"), "utf8")
    : fs.readFileSync(caPath);
if (!ca.toString("utf8").includes("-----BEGIN CERTIFICATE-----")) {
  throw new Error("The configured database CA certificate is not valid PEM data.");
}

const pool = new pg.Pool({
  connectionString,
  ssl: {
    ca,
    rejectUnauthorized: true,
    checkServerIdentity,
  },
  max: 1,
  connectionTimeoutMillis: 12_000,
});

try {
  const client = await pool.connect();
  try {
    if (!client.connection.stream.authorized) {
      throw new Error(`TLS peer was not authorized: ${client.connection.stream.authorizationError || "unknown reason"}`);
    }
    const result = await client.query("select current_database() as database");
    console.log(`connection=verified`);
    console.log(`host=${parsed.host}`);
    console.log(`database=${result.rows[0].database}`);
    console.log("tls_certificate_validation=passed");
    console.log("tls_hostname_validation=enabled");
  } finally {
    client.release();
  }
} catch (error) {
  const candidate = error instanceof Error ? error : new Error("Unknown connection failure");
  const code = "code" in candidate && typeof candidate.code === "string" ? candidate.code : "";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER|ALTNAME|HOSTNAME/i.test(code)) {
    console.error(`connection=failed`);
    console.error(`tls_error_code=${code}`);
    console.error(`tls_error=${candidate.message}`);
  } else {
    console.error(`connection=failed`);
    console.error(`error_code=${code || "unavailable"}`);
    console.error(`error_type=${candidate.name}`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
