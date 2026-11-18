import "server-only";
import { Pool, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set. For local mode, run npm run db and restart the app.");
  }
  return url;
}

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl(), max: 8 });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function withTransaction<T>(fn: (run: typeof query) => Promise<T>) {
  const client = await getPool().connect();
  const run = async <R extends QueryResultRow>(text: string, params: unknown[] = []) => {
    const result = await client.query<R>(text, params);
    return result.rows;
  };
  try {
    await client.query("begin");
    const value = await fn(run as typeof query);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function dbMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return "unknown";
  const message = String(error.message);
  if (message.includes("profiles_display_name_check")) return "invalid_name";
  if (message.includes("profiles_instagram_handle_check")) return "invalid_handle";
  if (message.includes("profiles_bio_check")) return "invalid_bio";
  if (message.includes("passengers_unique_role")) return "role_taken";
  return message.split("\n")[0] ?? "unknown";
}

export const ERROR_TEXT: Record<string, string> = {
  terms_not_accepted: "Accept the current terms and privacy notice to board.",
  policy_version_required: "Reload the page and accept the current terms.",
  terms_version_mismatch: "The terms changed. Reload the page and accept the current version.",
  privacy_version_mismatch: "The privacy notice changed. Reload the page and accept the current version.",
  registration_closed: "Registration is closed.",
  unknown_user: "This session is not a known account.",
  account_closed: "This account has already left the train.",
  handle_taken: "That Instagram handle is already verified on another ticket.",
  handle_missing: "There is no Instagram handle to verify.",
  forbidden: "The server refused the request.",
  user_mismatch: "The signed-in account does not match this registration.",
  invalid_name: "Use a display name between 2 and 32 characters.",
  invalid_handle: "Instagram usernames can use letters, numbers, periods and underscores.",
  invalid_bio: "The biography must be 280 characters or fewer.",
  already_voted: "You have already cast a vote in this poll.",
  poll_closed: "This poll is not open.",
  not_a_passenger: "Board the train before voting.",
  unauthenticated: "The session has expired. Sign in again.",
  invalid_option: "That option is not part of this poll.",
  payments_disabled: "Payments are disabled until the creator approves them.",
  not_admin: "This console is sealed.",
  role_disabled: "That role is disabled until the creator turns it on.",
  role_taken: "That unique role is already held.",
  passenger_missing: "No passenger matches that account.",
  poll_missing: "That poll does not exist.",
};
