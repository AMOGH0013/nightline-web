import { NextResponse } from "next/server";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { explain } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const voteInput = z.object({
  pollId: z.uuid(),
  optionId: z.uuid(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  const parsed = voteInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", message: "Choose a poll option." }, { status: 400 });
  }
  try {
    await withTransaction(async (run) => {
      await run(`select set_config('request.jwt.claim.sub', $1, true)`, [session.userId]);
      await run(`select set_config('request.jwt.claim.role', '', true)`);
      await run(`select public.cast_vote($1, $2)`, [parsed.data.pollId, parsed.data.optionId]);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
