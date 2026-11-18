import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getRuntime } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string | null;
  mode: "local" | "supabase";
};

const COOKIE = "nl_session";

type Token = { uid: string; email: string; exp: number };

export async function getSession(): Promise<Session | null> {
  const runtime = getRuntime();
  if (runtime.mode === "supabase") {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? null, mode: "supabase" };
  }
  if (runtime.mode !== "local") return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { userId: payload.uid, email: payload.email, mode: "local" };
}

export function signSession(userId: string, email: string) {
  const payload: Token = {
    uid: userId,
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function sessionCookie() {
  return COOKIE;
}

function verifyToken(token: string): Token | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Token;
    if (!payload.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionSecret() {
  const secret = process.env.LOCAL_SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("LOCAL_SESSION_SECRET must be at least 16 characters in local mode.");
  }
  return secret;
}
