"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export function BoardForm({
  mode,
  supabaseUrl,
  anonKey,
  siteUrl,
}: {
  mode: "local" | "supabase";
  supabaseUrl?: string;
  anonKey?: string;
  siteUrl: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      if (mode === "local") {
        const response = await fetch("/api/auth/local/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Could not start local sign-in.");
        setDevCode(body.devCode ?? "");
        setMessage("Local development code generated. It was not emailed.");
        return;
      }
      if (!supabaseUrl || !anonKey) throw new Error("Supabase Auth is not configured.");
      const supabase = createSupabaseBrowser(supabaseUrl, anonKey);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) throw error;
      setMessage("Check the inbox for a Supabase magic link or one-time code.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      if (mode === "local") {
        const response = await fetch("/api/auth/local/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "The code was rejected.");
        router.push("/register");
        router.refresh();
        return;
      }
      if (!supabaseUrl || !anonKey) throw new Error("Supabase Auth is not configured.");
      const supabase = createSupabaseBrowser(supabaseUrl, anonKey);
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      router.push("/register");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The code was rejected.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel max-w-xl p-6">
      <p className="kicker">{mode === "local" ? "Local development sign-in" : "Supabase email sign-in"}</p>
      <h1 className="display mt-3 text-4xl">Board</h1>
      <p className="mt-3 text-muted">
        {mode === "local"
          ? "This machine has no Supabase project. The code below is a local development shortcut and is labelled as such."
          : "Nightline never asks for an Instagram password. Supabase sends a magic link or one-time code to the email address."}
      </p>
      <form onSubmit={requestCode} className="mt-6 space-y-3">
        <label className="block text-sm">
          Email
          <input className="field mt-1" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button className="btn" disabled={pending} type="submit">Send code</button>
      </form>
      {devCode && (
        <p className="mt-4 border border-amber/50 bg-[#2a261c] p-3 text-sm">
          Local development code: <span className="mono text-amber">{devCode}</span>
        </p>
      )}
      <form onSubmit={verify} className="mt-6 space-y-3">
        <label className="block text-sm">
          One-time code
          <input className="field mt-1 mono" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <button className="btn secondary" disabled={pending} type="submit">Verify and continue</button>
      </form>
      {message && <p className="mt-4 text-sm text-olive">{message}</p>}
    </div>
  );
}
