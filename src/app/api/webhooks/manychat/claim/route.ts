import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRuntime } from "@/lib/env";
import { normalizeInstagramUsername } from "@/lib/follower-import-format";
import { consumeUsernameLookupLimit } from "@/lib/passengers";
import { withTransaction } from "@/lib/db";

export const runtime = "nodejs";

// Configure Manychat's External Request body explicitly with these mapped fields:
// contact_id (Manychat contact ID), instagram_username (provider supplied username),
// and optional instagram_scoped_id (only when independently supplied by Meta).
const payloadSchema = z.object({
  contact_id: z.string().trim().min(1).max(200),
  instagram_username: z.string().trim().min(1).max(300),
  instagram_scoped_id: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    return NextResponse.json({ error: "integration_not_configured" }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 8_192) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const username = normalizeInstagramUsername(parsed.data.instagram_username);
  if (!username) return NextResponse.json({ error: "invalid_instagram_username" }, { status: 400 });

  const rateKey = createHmac("sha256", secret).update(`manychat:${parsed.data.contact_id}`).digest("hex");
  try {
    if (!(await consumeUsernameLookupLimit(rateKey))) {
      return NextResponse.json({ error: "rate_limited", retry_after_seconds: 600 }, { status: 429 });
    }
    const result = await claimFollower({
      contactId: parsed.data.contact_id,
      igsid: parsed.data.instagram_scoped_id ?? null,
      username,
      secret,
    });
    if (!result) return NextResponse.json({ claimed: false, message: "No matching passenger record was found. Please check the Instagram account or contact NIGHTLINE support." });
    const ticketUrl = `${getRuntime().siteUrl.replace(/\/$/, "")}/ticket/claim/${result.token}`;
    return NextResponse.json({
      claimed: true,
      already_claimed: result.alreadyClaimed,
      passenger_number: result.permanentNumber,
      original_class: result.entitlement,
      seat: result.seat,
      ticket_url: ticketUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "claim_failed";
    const status = message === "identity_conflict" || message === "username_conflict" ? 409 : 503;
    return NextResponse.json({ error: status === 409 ? message : "temporarily_unavailable" }, { status });
  }
}

function authorized(header: string | null, secret: string) {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function claimFollower(input: { contactId: string; igsid: string | null; username: string; secret: string }) {
  return withTransaction(async (run) => {
    await run("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nightline.manychat_claim'))");
    const [prior] = await run<{
      passenger_id: string; current_username: string; permanent_number: number;
      original_entitlement: string; seat: string | null;
    }>(`select mi.passenger_id,mi.current_username,p.permanent_number,p.original_entitlement,
          ls.seat_code as seat
        from public.messaging_identities mi
        join public.passengers p on p.id=mi.passenger_id
        left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
        where mi.provider='manychat' and (mi.provider_contact_id=$1 or ($2::text is not null and mi.instagram_scoped_id=$2))
        for update of mi,p`, [input.contactId, input.igsid]);
    let passenger = prior?.passenger_id;
    if (prior && prior.current_username !== input.username) {
      const [collision] = await run<{ exists: boolean }>(`select exists(select 1 from public.follower_records where normalized_username=$1 and passenger_id<>$2) as exists`, [input.username, passenger]);
      if (collision?.exists) throw new Error("username_conflict");
      await run(`update public.follower_records set normalized_username=$2,updated_at=pg_catalog.now(),last_seen_at=pg_catalog.now()
        where passenger_id=$1`, [passenger, input.username]);
      await run(`update public.profiles pr set instagram_handle=$2,handle_verified=true
        from public.passengers p where p.id=$1 and pr.id=p.user_id`, [passenger, input.username]);
      await run(`update public.messaging_identities set current_username=$2,last_seen_at=pg_catalog.now()
        where provider='manychat' and passenger_id=$1`, [passenger, input.username]);
    }
    if (!passenger) {
      const [record] = await run<{ passenger_id: string }>(`select fr.passenger_id from public.follower_records fr
        join public.passengers p on p.id=fr.passenger_id where fr.normalized_username=$1 for update of fr,p`, [input.username]);
      if (!record) {
        await run(`insert into public.messaging_claim_attempts(provider,status,username) values('manychat','not_found',$1)`, [input.username]);
        return null;
      }
      passenger = record.passenger_id;
      const [identity] = await run<{ id: string; passenger_id: string }>(`select id,passenger_id from public.messaging_identities
        where provider='manychat' and (provider_contact_id=$1 or ($2::text is not null and instagram_scoped_id=$2)) for update`, [input.contactId,input.igsid]);
      if (identity && identity.passenger_id !== passenger) throw new Error("identity_conflict");
      await run(`insert into public.messaging_identities(provider,provider_contact_id,instagram_scoped_id,current_username,passenger_id)
        values('manychat',$1,$2,$3,$4)
        on conflict(provider,provider_contact_id) do update set instagram_scoped_id=coalesce(excluded.instagram_scoped_id,messaging_identities.instagram_scoped_id),
          current_username=excluded.current_username,last_seen_at=pg_catalog.now()
        where messaging_identities.passenger_id=excluded.passenger_id`, [input.contactId,input.igsid,input.username,passenger]);
      await run(`update public.profiles pr set handle_verified=true from public.passengers p where p.id=$1 and pr.id=p.user_id`, [passenger]);
    } else {
      await run(`insert into public.messaging_identities(provider,provider_contact_id,instagram_scoped_id,current_username,passenger_id)
        values('manychat',$1,$2,$3,$4)
        on conflict(provider,provider_contact_id) do update set last_seen_at=pg_catalog.now()
        where messaging_identities.passenger_id=excluded.passenger_id`, [input.contactId,input.igsid,input.username,passenger]);
    }
    const [ticket] = await run<{ permanent_number: number; original_entitlement: string; seat: string | null }>(
      `select p.permanent_number,p.original_entitlement,ls.seat_code as seat from public.passengers p
       left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold' where p.id=$1`, [passenger]);
    if (!ticket?.permanent_number) throw new Error("identity_conflict");
    const token = createHmac("sha256", input.secret).update(`ticket-access:${passenger}`).digest("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await run(`insert into public.passenger_ticket_access(passenger_id,token_hash) values($1,$2)
      on conflict(passenger_id) do update set token_hash=excluded.token_hash,revoked_at=null`, [passenger,tokenHash]);
    const [attempt] = await run<{ found: boolean }>(`select exists(select 1 from public.messaging_claim_attempts
      where provider='manychat' and username=$1 and status='claimed' and occurred_at > pg_catalog.now()-interval '1 minute') as found`, [input.username]);
    await run(`insert into public.messaging_claim_attempts(provider,status,username) values('manychat',$2,$1)`, [input.username, attempt?.found ? "already_claimed" : "claimed"]);
    return { token, permanentNumber: Number(ticket.permanent_number), entitlement: ticket.original_entitlement, seat: ticket.seat, alreadyClaimed: Boolean(attempt?.found || prior) };
  });
}
