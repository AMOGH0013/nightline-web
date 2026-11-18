import Link from "next/link";

export default function NotFound() {
  return (
    <section className="panel max-w-xl p-6">
      <h1 className="display text-4xl">This carriage is empty</h1>
      <p className="mt-3 text-muted">That page is not on the train.</p>
      <Link className="btn mt-5" href="/">Return</Link>
    </section>
  );
}
