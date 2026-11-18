import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

export function adminConfig(database, port = Number(process.env.NIGHTLINE_PG_PORT || 54329)) {
  const password = process.env.NIGHTLINE_PG_ADMIN_PASSWORD?.trim() || readAdminPassword();
  if (!password) {
    throw new Error("Set NIGHTLINE_PG_ADMIN_PASSWORD or initialize the local database with npm run db.");
  }
  return { host: "127.0.0.1", port, database, user: "postgres", password };
}

export function appConfig(database, port = Number(process.env.NIGHTLINE_PG_PORT || 54329)) {
  const connectionString = process.env.DATABASE_URL?.trim() || readLocalDatabaseUrl();
  if (!connectionString) throw new Error("Set DATABASE_URL to a local NIGHTLINE database before running this test.");

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The local DATABASE_URL is invalid; credentials are withheld.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Database-backed QA scripts only accept a loopback PostgreSQL host.");
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || port),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function readAdminPassword() {
  try {
    return fs.readFileSync(path.join(root, ".pgdata", "local-admin-password"), "utf8").trim();
  } catch {
    return "";
  }
}

function readLocalDatabaseUrl() {
  try {
    const line = fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .find((value) => /^\s*DATABASE_URL\s*=/.test(value));
    return line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(["'])(.*)\1$/, "$2") || "";
  } catch {
    return "";
  }
}
