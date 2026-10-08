import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCall } from "@/lib/dashboard";
import { designerEmail, escalationEmail } from "@/lib/email";
import { fmtDateTime, fmtDuration, fmtInr } from "@/lib/format";
import { ScoreBadge, StatusDot, TypeBadge, UrgentFlag, VerdictBadge } from "../../_components/badges";

export default function CallPage({ params }: PageProps<"/calls/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <Link href="/" className="text-sm text-stone-500 hover:underline">← All calls</Link>
      <Suspense fallback={<p className="mt-4 text-sm text-stone-500">Loading…</p>}>
        <CallDetail params={params} />
      </Suspense>
    </main>
  );
}

const GATE_LABEL: Record<string, string> = {
  real_project: "1 · Real project in scope",
  service_area: "2 · Service area",
  timeline: "3 · Realistic timeline",
  budget: "4 · Budget (only if volunteered)",
  decision_maker: "5 · Decision-maker",
};
const GATE_ORDER = Object.keys(GATE_LABEL);
const DIM_LABEL: Record<string, [string, number]> = {
  value: ["A · Project value", 4],
  readiness: ["B · Readiness", 2],
  commitment: ["C · Commitment", 2],
  source: ["D · Source", 1],
  completeness: ["E · Completeness", 1],
};

const FIELD_ORDER = [
  "caller_name", "phone", "property_type", "location", "sq_ft", "scope", "budget_band", "timeline", "decision_maker",
  "project", "complaint", "callback_request",
];
function orderedFields(f: Record<string, unknown>): [string, unknown][] {
  const rank = (k: string) => (FIELD_ORDER.includes(k) ? FIELD_ORDER.indexOf(k) : 99);
  return Object.entries(f).filter(([k]) => k !== "summary").sort(([a], [b]) => rank(a) - rank(b));
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function CallDetail({ params }: { params: PageProps<"/calls/[id]">["params"] }) {
  const { id } = await params;
  const data = await getCall(id);
  if (!data) notFound();
  const { call: c, bookings, actions, overrides, mergedLegs } = data;
  const f = (c.fields ?? {}) as Record<string, any>;
  const isLead = c.analysis_kind === "lead";
  const title = f.caller_name ?? (c.record_type === "missed_call" ? "Missed call" : c.record_type === "dropped_call" ? "Dropped call" : "Name not given");

  return (
    <div className="mt-3 space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{title}</h1>
        {c.urgent && <UrgentFlag />}
        {isLead ? <VerdictBadge verdict={c.verdict} overridden={!!c.override_verdict} /> : <TypeBadge type={c.record_type} />}
        {isLead && <ScoreBadge score={c.score} label={c.score_label} />}
        <span className="ml-auto text-sm text-stone-500">
          {c.external_id} · {c.source} · {fmtDateTime(c.started_at)} {c.after_hours ? "(after hours)" : "(business hours)"} · {fmtDuration(c.duration_s)}
        </span>
      </header>

      {c.merged_into && (
        <p className="rounded-md bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">
          This dropped call was merged into its callback: <Link className="text-accent hover:underline" href={`/calls/${c.merged_into}`}>open the merged record</Link>.
        </p>
      )}
      {c.analysis_status === "error" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Analysis failed: {c.analysis_error}
        </p>
      )}
      {c.override_verdict && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Nikhil overrode the verdict from <b>{c.ai_verdict}</b> to <b>{c.override_verdict}</b>{c.override_note ? `: “${c.override_note}”` : ""}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {c.summary && (
            <Card title="Summary">
              <p className="text-sm leading-relaxed">{c.summary}</p>
              {c.already_known && <p className="mt-2 text-sm text-stone-500">Already told us: {c.already_known}</p>}
            </Card>
          )}

          {isLead && c.gates && (
            <Card title="Five gates (qualification_logic.md · Step 1)">
              <ul className="space-y-2 text-sm">
                {GATE_ORDER.map((k) => {
                  const g = c.gates![k];
                  if (!g) return null;
                  const tone = g.result === "fail" ? "text-red-600" : g.result === "unclear" ? "text-sky-700 dark:text-sky-400" : g.result === "pass_tight" ? "text-amber-700" : "text-emerald-700 dark:text-emerald-400";
                  return (
                    <li key={k} className="grid grid-cols-[13rem_5.5rem_1fr] gap-2">
                      <span className="text-stone-600 dark:text-stone-400">{GATE_LABEL[k]}</span>
                      <span className={`font-medium ${tone}`}>{g.result.replace("_", " ")}</span>
                      <span className="text-stone-700 dark:text-stone-300">{g.evidence ? `“${g.evidence}”` : <i className="text-stone-400">no evidence</i>}</span>
                    </li>
                  );
                })}
              </ul>
              {!!c.reasons?.length && (
                <div className="mt-3 border-t border-stone-100 pt-3 text-sm dark:border-stone-800">
                  <div className="text-xs text-stone-500">Reasons</div>
                  <ul className="mt-1 list-disc pl-5">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              )}
            </Card>
          )}

          {(c.verdict === "qualified" || c.record_type === "escalation") && (
            <Card title={c.record_type === "escalation" ? "Escalation email preview (to Nikhil)" : "Designer email preview"}>
              <EmailPreview c={c} booking={(bookings.find((b) => b.status === "booked") as { slot_start: string } | undefined) ?? null} />
            </Card>
          )}

          <Card title="Transcript">
            {(c.legs?.length ?? 0) > 0 && (
              <p className="mb-2 text-xs text-stone-500">
                {c.legs.length} calls merged: {c.legs.map((l) => `${fmtDateTime(l.started_at)} ${l.status} (${fmtDuration(l.duration_s)})`).join(" → ")}
              </p>
            )}
            {mergedLegs.length > 0 && (
              <p className="mb-2 text-xs text-stone-500">Includes dropped call(s): {mergedLegs.map((m) => m.external_id).join(", ")}</p>
            )}
            {c.recording_url && (
              <audio controls preload="none" src={c.recording_url} className="mb-3 w-full">
                <a href={c.recording_url}>Recording</a>
              </audio>
            )}
            {c.transcript ? (
              <div className="space-y-1.5 text-sm leading-relaxed">
                {c.transcript.split("\n").map((line, i) => {
                  const m = line.match(/^([A-Za-z ]{2,20}):\s(.*)$/);
                  return m ? (
                    <p key={i}><span className={m[1] === "Caller" ? "font-medium text-accent" : "font-medium text-stone-500"}>{m[1]}:</span> {m[2]}</p>
                  ) : (
                    <p key={i} className="text-stone-500">{line}</p>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No conversation{c.status === "missed" ? " (missed call)" : ""}.</p>
            )}
            {c.notes && <p className="mt-3 rounded bg-stone-50 px-2 py-1.5 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">{c.notes}</p>}
          </Card>
        </div>

        <div className="space-y-4">
          {isLead && c.score_breakdown && (
            <Card title={`Lead score ${c.score}/10 · ${c.score_label}`}>
              <ul className="space-y-1.5 text-sm">
                {Object.entries(DIM_LABEL).map(([k, [label, max]]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-36 text-stone-600 dark:text-stone-400">{label}</span>
                    <span className="flex gap-0.5" aria-hidden>
                      {Array.from({ length: max }, (_, i) => (
                        <span key={i} className={`h-2.5 w-4 rounded-sm ${i < (c.score_breakdown![k] ?? 0) ? "bg-accent" : "bg-stone-200 dark:bg-stone-700"}`} />
                      ))}
                    </span>
                    <span className="tabular-nums">{c.score_breakdown![k]}/{max}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={c.analysis_kind === "escalation" ? "Escalation details" : "Extracted fields"}>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-sm">
              {orderedFields(f)
                .filter(([k, v]) => v !== null && v !== "" && !["scope_extent", "rooms_in_scope", "segment", "bhk"].includes(k))
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-stone-500">{k.replace(/_/g, " ")}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              <dt className="text-stone-500">caller number</dt>
              <dd>{c.caller_number ?? "—"}</dd>
            </dl>
            {!!c.handoff_notes?.length && (
              <div className="mt-3 text-sm">
                <div className="text-xs text-stone-500">Handoff notes</div>
                <ul className="mt-1 list-disc pl-5">{c.handoff_notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}
          </Card>

          {isLead && !!c.opening_questions?.length && (
            <Card title="Open the conversation with">
              <ol className="list-decimal space-y-1 pl-5 text-sm">{c.opening_questions.map((q) => <li key={q}>{q}</li>)}</ol>
            </Card>
          )}

          {isLead && c.indicative_range && (
            <Card title="Internal pricing guide (designer only)">
              <p className="text-sm">{c.indicative_range}</p>
              <p className="mt-1 text-xs text-stone-500">
                {c.asked_about_price ? "Caller asked about price; no figure was shared." : "Caller did not ask about price."} Never quoted to callers.
              </p>
            </Card>
          )}

          <Card title="Handoff">
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between"><span>Consultation</span><StatusDot status={c.booking_status} /></li>
              {bookings.map((b) => (
                <li key={b.id} className="text-xs text-stone-500">
                  {fmtDateTime(b.slot_start)} · {b.status}
                  {b.html_link && <> · <a className="text-accent hover:underline" href={b.html_link} target="_blank" rel="noreferrer">Calendar</a></>}
                </li>
              ))}
              <li className="flex justify-between"><span>{c.record_type === "escalation" ? "Escalation email" : "Designer email"}</span><StatusDot status={c.email_status} /></li>
              <li className="flex justify-between"><span>HubSpot</span><StatusDot status={c.hubspot_status} /></li>
              {c.hubspot_deal_id && <li className="text-xs text-stone-500">Deal {c.hubspot_deal_id}</li>}
              {c.callback_status && <li className="flex justify-between"><span>Call-back</span><span className="text-xs">{c.callback_status}</span></li>}
            </ul>
            {actions.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-stone-500">Audit log ({actions.length})</summary>
                <ul className="mt-1 space-y-1">
                  {actions.map((a) => <li key={a.id}>{fmtDateTime(a.created_at)} · {a.type} · {a.status}{a.error ? ` · ${a.error}` : ""}</li>)}
                </ul>
              </details>
            )}
            {overrides.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-stone-500">Overrides ({overrides.length})</summary>
                <ul className="mt-1 space-y-1">{overrides.map((o) => <li key={o.id}>{fmtDateTime(o.created_at)} · {o.old_verdict ?? "—"} → {o.new_verdict}{o.note ? ` · ${o.note}` : ""}</li>)}</ul>
              </details>
            )}
          </Card>

          <p className="text-xs text-stone-400">
            {c.model ?? "no model"} · {c.tokens_in.toLocaleString()} in / {c.tokens_out.toLocaleString()} out tokens · {fmtInr(Number(c.gemini_cost_inr), 3)}
          </p>
        </div>
      </div>
    </div>
  );
}

function EmailPreview({ c, booking }: { c: Parameters<typeof designerEmail>[0] & { record_type: string | null }; booking: { slot_start: string } | null }) {
  const baseUrl = process.env.APP_BASE_URL ?? "";
  const e =
    c.record_type === "escalation"
      ? escalationEmail(c, { baseUrl })
      : designerEmail(c, booking, { designerName: process.env.DESIGNER_NAME, baseUrl });
  return (
    <div className="text-sm">
      <p className="mb-2 font-medium">{e.subject}</p>
      <pre className="max-h-96 overflow-auto rounded bg-stone-50 p-3 font-sans text-[13px] whitespace-pre-wrap dark:bg-stone-800">{e.text}</pre>
    </div>
  );
}
