import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { badRequest, jsonError } from "@/lib/http";
import { explain, readOwned } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const submissionInput = z.object({
  body: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  const parsed = submissionInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Write a note of 2000 characters or fewer.");
  const passenger = await readOwned(session.userId);
  if (!passenger || passenger.anonymised_at) {
    return NextResponse.json(
      { error: "not_a_passenger", message: "Board the train before sending a note." },
      { status: 400 },
    );
  }
  try {
    await query(`insert into public.submissions (user_id, body) values ($1, $2)`, [passenger.user_id, parsed.data.body]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
