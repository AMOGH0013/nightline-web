"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RegisterForm({ termsVersion, privacyVersion }: { termsVersion: string; privacyVersion: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [accept, setAccept] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, instagram, accept, termsVersion, privacyVersion }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Registration failed.");
      router.push(body.already_registered ? "/ticket?existing=1" : "/ticket");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel max-w-xl space-y-4 p-6">
      <p className="kicker">Passenger registration</p>
      <h1 className="display text-4xl">Take a number</h1>
      <p className="text-sm text-muted">
        The server allocates the number. A number typed into the browser is ignored. Instagram is optional and stays unverified until the creator confirms it.
      </p>
      <label className="block text-sm">
        Display name
        <input className="field mt-1" required minLength={2} maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="block text-sm">
        Instagram username, optional
        <input className="field mt-1" value={instagram} onChange={(event) => setInstagram(event.target.value)} placeholder="without a password" />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={accept} onChange={(event) => setAccept(event.target.checked)} className="mt-1" />
        <span>
          I accept the <a className="underline" href="/terms">terms {termsVersion}</a> and the <a className="underline" href="/privacy">privacy notice {privacyVersion}</a>.
        </span>
      </label>
      <button className="btn" disabled={pending || !accept} type="submit">
        {pending ? "Allocating…" : "Issue ticket"}
      </button>
      {message && <p className="text-sm text-danger">{message}</p>}
    </form>
  );
}
