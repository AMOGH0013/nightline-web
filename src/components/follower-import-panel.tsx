"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Preview = {
  importId: string;
  confirmable: boolean;
  counts: { total: number; unique: number; duplicates: number; malformed: number; missingTimestamps: number; tiedTimestampRecords: number; existing: number; new: number; lateHistorical: number; legacyConflicts: number };
  preview: { username: string; followerRank: number; permanentNumber: number; entitlement: string; disposition: string; seat: string | null }[];
};
type History = { id: string; file_names: string[]; status: string; total_records: number; unique_records: number; duplicate_records: number; malformed_records: number; missing_timestamps: number; late_historical_records: number; created_at: string; confirmed_at: string | null };

export function FollowerImportPanel({ history }: { history: History[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowLate, setAllowLate] = useState(false);
  const [allowMissingTimestamps, setAllowMissingTimestamps] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setPreview(null); setProgress(0);
    if (!files.length) { setMessage("Choose at least one Instagram follower JSON or ZIP file."); return; }
    setPending(true);
    try {
      const data = new FormData(); files.forEach((file) => data.append("files", file));
      const body = await new Promise<Preview>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/admin/followers/preview");
        xhr.upload.onprogress = (item) => { if (item.lengthComputable) setProgress(Math.round(item.loaded / item.total * 100)); };
        xhr.onload = () => { const payload = JSON.parse(xhr.responseText || "{}"); if (xhr.status < 200 || xhr.status >= 300) reject(new Error(payload.message ?? payload.error ?? "The follower export could not be previewed.")); else resolve(payload as Preview); };
        xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again.")); xhr.send(data);
      });
      setPreview(body); setSearch(""); setPage(0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The follower export could not be previewed.");
    } finally { setPending(false); setProgress(0); }
  }

  async function confirm() {
    if (!preview) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/admin/followers/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importId: preview.importId, approveLateHistorical: allowLate, approveMissingTimestamps: allowMissingTimestamps }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The follower manifest was not confirmed.");
      setMessage(`Import completed successfully. New passengers: ${body.allocated}. Existing passengers retained: ${body.existingRetained}. Duplicates skipped: ${body.skippedDuplicates}. Requires review: ${body.requiresReview}.`);
      setPreview(null); setFiles([]); if (fileInput.current) fileInput.current.value = ""; router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The follower manifest was not confirmed."); }
    finally { setPending(false); }
  }

  const filtered = preview?.preview.filter((row) => `${row.username} ${row.permanentNumber} ${row.followerRank}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const rows = filtered.slice(page * 25, page * 25 + 25);
  return (
    <section className="panel space-y-4 p-6">
      <div><p className="kicker">Passenger Management</p><h2 className="display mt-2 text-3xl">Import Instagram Followers</h2>
        <p className="mt-2 text-sm text-muted">Use Instagram’s account-data export. A follower snapshot is not a complete historical list. Existing passenger numbers never change. Equal follow timestamps retain source-file order and are flagged below.</p></div>
      <form onSubmit={upload} className="space-y-3">
        <input ref={fileInput} className="sr-only" type="file" name="files" accept=".json,.zip,application/json,application/zip" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        <div role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); setFiles(Array.from(event.dataTransfer.files)); }}
          className={`border border-dashed p-6 text-center transition ${dragging ? "border-amber bg-amber/10" : "border-line"}`}>
          <p className="display text-xl">Drop follower exports here</p><p className="mt-2 text-sm text-muted">ZIP export or direct follower JSON · supports followers_1.json and split files · 20 MB maximum</p>
          <button className="btn secondary mt-4" type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>Browse files</button>
          {files.length > 0 && <p className="mt-3 text-xs text-olive">{files.length} file(s): {files.map((file) => file.name).join(", ")}</p>}
        </div>
        {pending && progress > 0 && <div aria-label="Upload progress" className="h-2 bg-line"><div className="h-2 bg-amber transition-all" style={{ width: `${progress}%` }} /></div>}
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted">JSON or ZIP · 20 MB maximum</span><button className="btn" type="submit" disabled={pending || !files.length}>{pending ? `Uploading and validating ${progress}%…` : "Preview allocation"}</button></div>
      </form>
      {message && <p role="status" className="text-sm text-olive">{message}</p>}
      {preview && <div className="space-y-4 border-t border-line pt-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">{Object.entries({ Records: preview.counts.total, Unique: preview.counts.unique, Duplicates: preview.counts.duplicates, Invalid: preview.counts.malformed, "Missing timestamps": preview.counts.missingTimestamps, "Tied timestamp records": preview.counts.tiedTimestampRecords, Existing: preview.counts.existing, New: preview.counts.new, "Late historical": preview.counts.lateHistorical, "Identity conflicts": preview.counts.legacyConflicts }).map(([label, value]) => <div key={label}><dt className="kicker">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
        {preview.counts.tiedTimestampRecords > 0 && <p className="text-sm text-amber">Some followers share timestamps. Their order follows the supplied export order; confirm that order before import.</p>}
        {preview.counts.missingTimestamps > 0 && <label className="flex gap-3 text-sm"><input type="checkbox" checked={allowMissingTimestamps} onChange={(event) => setAllowMissingTimestamps(event.target.checked)} />I reviewed the {preview.counts.missingTimestamps} missing timestamp record(s). Append these after timestamped followers in supplied file order and record them as first observed, not verified historical order.</label>}
        {preview.preview.length > 0 && <div className="space-y-3 border border-line p-3">
          <label className="block text-sm">Search preview<input className="field mt-1" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Username or passenger number" /></label>
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="kicker"><tr><th>Username</th><th>Rank</th><th>Passenger</th><th>Class</th><th>Seat</th><th>Status</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.username} className="border-t border-line"><td className="py-2">@{row.username}</td><td>{row.followerRank}</td><td>{row.permanentNumber}</td><td>{row.entitlement}</td><td>{row.seat ?? "—"}</td><td>{row.disposition}</td></tr>)}
          </tbody></table></div>
          <div className="flex items-center justify-between text-xs text-muted"><span>{filtered.length ? `Showing ${page * 25 + 1}–${Math.min((page + 1) * 25, filtered.length)} of ${filtered.length}` : "No matching passengers"} (preview limit 1,000)</span><div className="flex gap-2"><button className="btn secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn secondary" type="button" disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Next</button></div></div>
          {preview.counts.new + preview.counts.lateHistorical > preview.preview.length && <p className="text-xs text-muted">First 1,000 new allocations shown; confirmation processes the complete validated import.</p>}
        </div>}
        {preview.counts.lateHistorical > 0 && <label className="flex gap-3 text-sm"><input type="checkbox" checked={allowLate} onChange={(event) => setAllowLate(event.target.checked)} />Approve late historical followers to append after the current highest passenger number. Existing identities are not renumbered.</label>}
        {!preview.confirmable && <p className="text-sm text-danger">This import needs correction or review before it can be applied. No identities have been changed.</p>}
        <button className="btn" type="button" disabled={pending || !preview.confirmable || (preview.counts.lateHistorical > 0 && !allowLate) || (preview.counts.missingTimestamps > 0 && !allowMissingTimestamps)} onClick={confirm}>Confirm Import</button>
      </div>}
      <div className="border-t border-line pt-4"><h3 className="display text-xl">Import history</h3>{history.length === 0 ? <p className="mt-2 text-sm text-muted">No follower exports have been imported.</p> : <ul className="mt-2 space-y-2 text-xs text-muted">{history.map((item) => <li key={item.id} className="border-t border-line pt-2">{item.created_at} · {item.status} · {item.unique_records} unique of {item.total_records} · {item.file_names.join(", ")}{item.status === "confirmed" && <span className="mt-2 flex gap-3"><a className="underline" href={`/api/admin/followers/export?importId=${item.id}&format=csv`}>Download CSV</a><a className="underline" href={`/api/admin/followers/export?importId=${item.id}&format=json`}>Download JSON</a></span>}</li>)}</ul>}</div>
    </section>
  );
}
