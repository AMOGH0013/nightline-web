import "server-only";

export type RuntimeMode = "local" | "supabase" | "misconfigured";

export type Runtime = {
  mode: RuntimeMode;
  siteUrl: string;
  databaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  serviceRoleKey?: string;
};

export function getRuntime(): Runtime {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const supabaseUrl = blank(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = blank(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey = blank(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const databaseUrl = blank(process.env.DATABASE_URL);
  const supabaseParts = [supabaseUrl, supabaseAnonKey, serviceRoleKey].filter(Boolean).length;

  if (supabaseParts === 3 && databaseUrl) {
    return {
      mode: "supabase",
      siteUrl,
      databaseUrl,
      supabaseUrl,
      supabaseAnonKey,
      serviceRoleKey,
    };
  }
  if (supabaseParts > 0) {
    return { mode: "misconfigured", siteUrl, databaseUrl, supabaseUrl, supabaseAnonKey };
  }
  return { mode: "local", siteUrl, databaseUrl };
}

function blank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
