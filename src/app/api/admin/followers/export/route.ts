import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const paramsSchema = z.object({ importId: z.uuid(), format: z.enum(["csv","json"]).default("csv") });

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error:"unauthenticated" },{status:401});
  if (!(await isAdmin(session.userId))) return NextResponse.json({ error:"not_admin" },{status:403});
  const search = new URL(request.url).searchParams;
  const parsed = paramsSchema.safeParse({ importId:search.get("importId"),format:search.get("format") ?? "csv" });
  if (!parsed.success) return NextResponse.json({ error:"invalid_export_request" },{status:400});
  const [batch] = await query<{ file_names: string[]; confirmed_at: string | null }>(
    "select file_names,confirmed_at::text as confirmed_at from public.follower_manifest_imports where id=$1 and status='confirmed'",[parsed.data.importId]);
  if (!batch) return NextResponse.json({ error:"import_not_found" },{status:404});
  const records = await query<{
    username:string; follower_rank:number; permanent_number:number; original_class:string;
    current_accommodation:string; seat:string|null; import_status:string; claimed:boolean;
  }>(`select fir.normalized_username as username,fir.follower_rank::int,fir.permanent_number::int,
      fir.original_entitlement as original_class,p.seat_class as current_accommodation,ls.seat_code as seat,
      fir.assignment_status as import_status,
      exists(select 1 from public.messaging_identities mi where mi.passenger_id=p.id) as claimed
    from public.follower_import_records fir join public.passengers p on p.id=fir.passenger_id
    left join public.luxury_seat_inventory ls on ls.passenger_id=p.id and ls.status='sold'
    where fir.import_id=$1 order by fir.follower_rank`,[parsed.data.importId]);
  const payload = { importId:parsed.data.importId,sourceFiles:batch.file_names,importedAt:batch.confirmed_at,records };
  if (parsed.data.format === "json") return new NextResponse(JSON.stringify(payload,null,2),{
    headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="nightline-followers-${parsed.data.importId}.json"`,"cache-control":"no-store"},
  });
  const columns = ["passenger_number","instagram_username","follower_rank","original_class","current_accommodation","physical_seat","import_status","claimed","import_source","imported_at"];
  const lines = [columns.join(","),...records.map((r)=>[
    r.permanent_number,r.username,r.follower_rank,r.original_class,r.current_accommodation,r.seat ?? "",r.import_status,r.claimed,
    batch.file_names.join("; "),batch.confirmed_at ?? "",
  ].map(csv).join(","))];
  return new NextResponse(lines.join("\r\n"),{
    headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="nightline-followers-${parsed.data.importId}.csv"`,"cache-control":"no-store"},
  });
}

function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}
