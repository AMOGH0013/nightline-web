"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Poll } from "@/lib/content";
import { formatWhen } from "@/lib/format";

export function VotePanel({ polls, signedIn }: { polls: Poll[]; signedIn: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState("");

  async function vote(pollId: string, optionId: string) {
    setPending(optionId);
    setMessage("");
    const response = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pollId, optionId }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Vote recorded." : body.message ?? "Vote rejected.");
    setPending("");
    router.refresh();
  }

  if (polls.length === 0) {
    return <p className="panel p-6 text-muted">No polls have been published.</p>;
  }

  return (
    <div className="space-y-5">
      {polls.map((poll) => (
        <article key={poll.id} className="panel p-6">
          <p className="kicker">{poll.state}</p>
          <h2 className="display mt-2 text-3xl">{poll.title}</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{poll.story}</p>
          <p className="mono mt-3 text-xs text-olive">
            {formatWhen(poll.opens_at)} – {formatWhen(poll.closes_at)}
          </p>
          <div className="mt-4 space-y-2">
            {poll.options.map((option) => (
              <button
                key={option.id}
                className="btn secondary w-full !justify-between"
                type="button"
                disabled={!signedIn || poll.state !== "open" || pending === option.id}
                onClick={() => vote(poll.id, option.id)}
              >
                <span>{option.label}</span>
                <span>{poll.myVote === option.id ? "Your vote" : ""}</span>
              </button>
            ))}
          </div>
          {!signedIn && <p className="mt-3 text-sm">Sign in as a passenger to vote. Each passenger has one vote.</p>}
          {poll.results.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm">
              {poll.results.map((result) => (
                <li key={result.option_id} className="flex justify-between border-t border-line py-2">
                  <span>{result.label}</span>
                  <span className="mono">{result.votes}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {poll.show_results === "hidden"
                ? "Results are not published."
                : poll.show_results === "after_close" && poll.state !== "closed"
                  ? "Results open when the poll closes."
                  : "No tally yet."}
            </p>
          )}
        </article>
      ))}
      {message && <p className="text-sm text-olive">{message}</p>}
    </div>
  );
}
