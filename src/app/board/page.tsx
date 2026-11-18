import { redirect } from "next/navigation";
import { BoardForm } from "@/components/board-form";
import { getRuntime } from "@/lib/env";
import { readOwned } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export default async function BoardPage() {
  const runtime = getRuntime();
  if (runtime.mode === "misconfigured") {
    return (
      <section className="panel max-w-xl p-6">
        <h1 className="display text-4xl">Sign-in is not configured</h1>
        <p className="mt-3 text-muted">
          Add all three Supabase variables and DATABASE_URL, or remove the Supabase variables and use local development mode. The service role key is never sent to the browser.
        </p>
      </section>
    );
  }
  const session = await getSession();
  if (session) {
    const passenger = await readOwned(session.userId);
    redirect(passenger ? "/dashboard" : "/register");
  }
  return (
    <BoardForm
      mode={runtime.mode}
      supabaseUrl={runtime.supabaseUrl}
      anonKey={runtime.supabaseAnonKey}
      siteUrl={runtime.siteUrl}
    />
  );
}
