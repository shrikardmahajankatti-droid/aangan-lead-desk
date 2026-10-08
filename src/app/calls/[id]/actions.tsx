"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  id: string;
  isLead: boolean;
  hasTranscript: boolean;
  verdict: string | null;
  emailStatus: string;
  hubspotStatus: string;
  qualifiedOrEscalation: boolean;
  isEscalation: boolean;
};

const btn =
  "rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800";

export function CallActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [verdict, setVerdict] = useState(p.verdict === "qualified" ? "not_qualified" : "qualified");
  const [note, setNote] = useState("");

  async function call(action: string, body?: unknown) {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch(`/api/calls/${p.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      setMsg(res.ok ? summarise(action, json) : `Failed: ${json.error ?? res.statusText}`);
      startTransition(() => router.refresh());
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const canEmail = p.qualifiedOrEscalation && p.emailStatus !== "done";
  const canHubspot = p.isLead && p.verdict === "qualified" && p.hubspotStatus !== "done" && !p.isEscalation;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!!busy || !p.hasTranscript} onClick={() => call("rerun")}
          title={p.hasTranscript ? "Run the Gemini analysis again (history is kept)" : "No conversation to analyse"}>
          {busy === "rerun" ? "Re-running…" : "Re-run Gemini"}
        </button>
        <button className={btn} disabled={!!busy || !canEmail} onClick={() => call("resend")}
          title={p.emailStatus === "done" ? "Already sent; never sent twice" : "Send (or retry) the handoff email"}>
          {busy === "resend" ? "Sending…" : p.isEscalation ? "Resend escalation email" : "Resend email"}
        </button>
        <button className={btn} disabled={!!busy || !canHubspot} onClick={() => call("retry-hubspot")}
          title={p.isEscalation ? "Escalations never go to HubSpot" : p.hubspotStatus === "done" ? "Already synced" : "Push (or retry) to HubSpot"}>
          {busy === "retry-hubspot" ? "Pushing…" : "Retry HubSpot"}
        </button>
      </div>

      {p.isLead && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 dark:border-stone-800"
          onSubmit={(e) => {
            e.preventDefault();
            if (verdict === "qualified" && !confirm("Override to Qualified? This sends the designer email and pushes to HubSpot (once)."))
              return;
            call("override", { verdict, note });
          }}
        >
          <span className="text-sm font-medium">Override verdict</span>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900" aria-label="New verdict">
            <option value="qualified">Qualified</option>
            <option value="not_qualified">Not qualified</option>
            <option value="nurture">Nurture</option>
            <option value="needs_info">Needs info</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" maxLength={500}
            className="min-w-40 flex-1 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900" />
          <button className={btn} disabled={!!busy || verdict === p.verdict}>{busy === "override" ? "Saving…" : "Save"}</button>
        </form>
      )}

      {msg && <p className="text-sm text-stone-600 dark:text-stone-300" role="status">{msg}</p>}
    </div>
  );
}

function summarise(action: string, j: Record<string, any>): string {
  if (action === "rerun") return j.error ? j.error : `Re-analysed: ${j.verdict ?? j.record_type}.`;
  const parts = [j.email && `Email: ${j.email.status}${j.email.detail ? ` (${j.email.detail})` : ""}`,
    j.hubspot && `HubSpot: ${j.hubspot.status}${j.hubspot.detail ? ` (${j.hubspot.detail})` : ""}`,
    j.delivered?.email && `Email: ${j.delivered.email.status}`, j.delivered?.hubspot && `HubSpot: ${j.delivered.hubspot.status}`,
    action === "override" && `Verdict now ${j.verdict}.`].filter(Boolean);
  return parts.join(" · ") || "Done.";
}
