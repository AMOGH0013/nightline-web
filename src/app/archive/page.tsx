import { formatWhen } from "@/lib/format";
import { readArchive } from "@/lib/content";

const kinds = ["episode", "location", "decision", "vote_outcome", "event", "transmission", "discovery"];

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const params = await searchParams;
  const kind = params.kind && kinds.includes(params.kind) ? params.kind : undefined;
  const entries = await readArchive(kind).catch(() => null);
  return (
    <div>
      <p className="kicker">Record of the line</p>
      <h1 className="display mt-2 text-5xl">Archive</h1>
      <div className="mt-5 flex flex-wrap gap-2">
        <a className={`btn secondary !min-h-0 !px-3 !py-2 ${!kind ? "!border-amber" : ""}`} href="/archive">All</a>
        {kinds.map((item) => (
          <a key={item} className={`btn secondary !min-h-0 !px-3 !py-2 ${kind === item ? "!border-amber" : ""}`} href={`/archive?kind=${item}`}>
            {item.replace("_", " ")}
          </a>
        ))}
      </div>
      {entries === null && <p className="mt-6 text-danger">The archive could not be read.</p>}
      {entries?.length === 0 && <p className="panel mt-6 p-6 text-muted">Nothing has been published in this section.</p>}
      <div className="mt-6 space-y-4">
        {entries?.map((entry) => (
          <article key={entry.id} className="panel p-6">
            <p className="kicker">{entry.kind.replace("_", " ")} · {formatWhen(entry.occurred_on ?? entry.created_at)}</p>
            <h2 className="display mt-2 text-3xl">{entry.title}</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{entry.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
