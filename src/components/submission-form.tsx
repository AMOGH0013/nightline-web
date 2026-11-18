"use client";

import { useState } from "react";

export function SubmissionForm() {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Sent to the conductor’s desk." : payload.message ?? "Could not send.");
    if (response.ok) setBody("");
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="panel space-y-3 p-6">
      <h2 className="display text-2xl">Note to the train</h2>
      <textarea className="field min-h-28" maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} required />
      <button className="btn" disabled={pending} type="submit">Submit</button>
      {message && <p className="text-sm text-olive">{message}</p>}
    </form>
  );
}
