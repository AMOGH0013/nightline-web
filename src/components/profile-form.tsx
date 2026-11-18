"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProfileForm(props: {
  displayName: string;
  instagram: string;
  bio: string;
  handlePublic: boolean;
  listed: boolean;
  videoConsent: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(props);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await response.json();
    setMessage(response.ok ? "Profile saved." : body.message ?? "Could not save.");
    setPending(false);
    router.refresh();
  }

  async function depart() {
    if (!window.confirm("Anonymise this account? The seat stays occupied and the name is removed.")) return;
    setPending(true);
    const response = await fetch("/api/account", { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.message ?? "Could not close the account.");
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="panel space-y-4 p-6">
      <h2 className="display text-2xl">Edit public details</h2>
      <label className="block text-sm">
        Display name
        <input className="field mt-1" value={form.displayName} onChange={(event) => set("displayName", event.target.value)} />
      </label>
      <label className="block text-sm">
        Instagram username
        <input className="field mt-1" value={form.instagram} onChange={(event) => set("instagram", event.target.value)} />
      </label>
      <label className="block text-sm">
        Biography
        <textarea className="field mt-1 min-h-28" maxLength={280} value={form.bio} onChange={(event) => set("bio", event.target.value)} />
      </label>
      <label className="flex gap-3 text-sm">
        <input type="checkbox" checked={form.handlePublic} onChange={(event) => set("handlePublic", event.target.checked)} />
        Show the Instagram handle on the public manifest
      </label>
      <label className="flex gap-3 text-sm">
        <input type="checkbox" checked={form.listed} onChange={(event) => set("listed", event.target.checked)} />
        List this passenger in the public manifest
      </label>
      <label className="flex gap-3 text-sm">
        <input type="checkbox" checked={form.videoConsent} onChange={(event) => set("videoConsent", event.target.checked)} />
        Allow my Instagram username to appear in NIGHTLINE passenger manifests and future videos. This is optional and can be withdrawn later.
      </label>
      <div className="flex flex-wrap gap-3">
        <button className="btn" disabled={pending} type="submit">Save</button>
        <button className="btn secondary" disabled={pending} type="button" onClick={depart}>Leave and anonymise</button>
      </div>
      {message && <p className="text-sm text-olive">{message}</p>}
    </form>
  );
}
