import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session.userId))) return NextResponse.json({ error: "not_admin" }, { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const episode = (url.searchParams.get("episode") ?? "").trim().slice(0, 120);
  const passengers = await query<{
    passenger_number: number;
    follower_rank: number;
    instagram_username: string;
    original_entitlement: string;
    current_accommodation: string;
    premium_seat_number: string | null;
    carriage: number | null;
    seat: string | null;
    video_display_eligible: boolean;
    approved_public_label: string | null;
  }>(
    `select p.permanent_number as passenger_number,p.follower_rank,lower(pr.instagram_handle) as instagram_username,
      p.original_entitlement,p.seat_class as current_accommodation,ls.seat_code as premium_seat_number,
      p.carriage,p.seat_label as seat, true as video_display_eligible,vc.approved_public_label
     from public.passenger_video_consent vc
     join public.passengers p on p.id=vc.passenger_id
     join public.profiles pr on pr.id=p.user_id
     left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
     where vc.allowed and pr.instagram_handle is not null and p.permanent_number is not null
       and pr.anonymised_at is null and pr.moderation='ok'
     order by p.permanent_number`,
  );
  const filename = episode ? `nightline-${slug(episode)}-passengers.${format}` : `nightline-approved-passengers.${format}`;
  if (format === "csv") {
    const headers = ["passenger_number", "follower_rank", "instagram_username", "original_entitlement", "current_accommodation", "premium_seat_number", "carriage", "seat", "video_display_eligible", "approved_public_label"];
    const csv = [headers, ...passengers.map((row) => headers.map((key) => row[key as keyof typeof row]))]
      .map((row) => row.map((value) => csvValue(value)).join(",")).join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" } });
  }
  return new Response(JSON.stringify({ episode: episode || null, generatedAt: new Date().toISOString(), passengers }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" },
  });
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "episode";
}
