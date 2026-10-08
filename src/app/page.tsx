import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { kpis, listCalls, callbackList, type CallRow } from "@/lib/dashboard";
import { fmtDateTime, fmtInr, pct, TYPE_LABEL } from "@/lib/format";
import { ScoreBadge, StatusDot, TypeBadge, UrgentFlag, VerdictBadge } from "./_components/badges";

export default function Dashboard({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6">
      <Suspense fallback={<TilesSkeleton />}>
        <Tiles />
      </Suspense>
      <Suspense fallback={null}>
        <Callbacks />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-stone-500">Loading calls…</p>}>
        <Calls searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function TilesSkeleton() {
  return <div className="h-48 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />;
}

async function Tiles() {
  await connection();
  const k = await kpis();
  const c = k.cost;
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Calls handled" value={k.calls} sub={`${k.outOfScope} WhatsApp/web form out of scope`} />
      <Tile
        label="Answered within 5 min"
        value={pct(k.answeredWithin5, k.answeredKnown)}
        sub={`${k.answeredWithin5}/${k.answeredKnown} · target 100%`}
        tone={k.answeredWithin5 === k.answeredKnown ? "" : "text-amber-700 dark:text-amber-400"}
      />
      <Tile label="After hours" value={pct(k.afterHours, k.calls)} sub={`${k.afterHours} outside 10am–7pm`} />
      <Tile
        label="Qualified"
        value={pct(k.qualified, k.leads)}
        sub={`${k.qualified}/${k.leads} leads · 🔥${k.hot} Hot · ${k.warm} Warm · ${k.standard} Std`}
      />
      <Tile label="Consultations booked" value={k.bookings} sub={k.bookingsDryRun ? `${k.bookingsDryRun} dry run` : "Google Calendar"} />
      <Tile
        label="Running cost"
        value={fmtInr(c.totalInr)}
        sub={`${c.perQualifiedInr === null ? "—" : fmtInr(c.perQualifiedInr)} per qualified lead`}
      />
      <Tile label="Designer emails sent" value={k.emailsSent} sub={k.emailsDryRun ? `${k.emailsDryRun} dry run` : "Resend"} />
      <Tile label="HubSpot synced" value={k.hubspotSynced} sub={k.hubspotDryRun ? `${k.hubspotDryRun} dry run` : "Contact + deal"} />
      <Tile label="Escalations" value={k.escalations} sub="To Nikhil, never HubSpot" tone={k.escalations ? "text-red-600" : ""} />
      <Tile label="Call-back list" value={k.callbacks} sub="Missed, dropped, needs info" />
      <Tile
        label="Cost breakdown"
        value={<span className="text-base">{fmtInr(c.vaaniInr)} + {fmtInr(c.geminiInr)}</span>}
        sub={`Vaani ${c.vaaniMinutes} min · Gemini ${(c.tokensIn / 1000).toFixed(0)}k in / ${(c.tokensOut / 1000).toFixed(0)}k out`}
      />
      <Tile label="Processing errors" value={k.errors} sub="Re-run from the call page" tone={k.errors ? "text-red-600" : ""} />
    </section>
  );
}

async function Callbacks() {
  await connection();
  const rows = await callbackList();
  if (!rows.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Call-back list ({rows.length})</h2>
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <TypeBadge type={r.record_type} />
            {r.verdict === "needs_info" && <VerdictBadge verdict="needs_info" />}
            <Link href={`/calls/${r.id}`} className="font-medium hover:underline">
              {(r.fields?.caller_name as string) ?? r.caller_number ?? "Unknown caller"}
            </Link>
            <span className="text-stone-500">{fmtDateTime(r.started_at)}</span>
            <span className="text-stone-500">{r.caller_number ?? "number not captured"}</span>
            <span className="ml-auto text-xs text-stone-400">{r.external_id}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Calls({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const filters = { q: one(sp.q), verdict: one(sp.verdict), type: one(sp.type), label: one(sp.label) };
  const rows = await listCalls(filters);
  const select = "rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <h2 className="mr-auto text-sm font-semibold">Calls ({rows.length})</h2>
        <form className="flex flex-wrap gap-2" action="/">
          <input name="q" defaultValue={filters.q} placeholder="Search name, area, transcript…" className={`${select} w-56`} />
          <select name="type" defaultValue={filters.type ?? ""} className={select} aria-label="Record type">
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).filter(([k]) => k !== "out_of_scope_channel").map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select name="verdict" defaultValue={filters.verdict ?? ""} className={select} aria-label="Verdict">
            <option value="">All verdicts</option>
            <option value="qualified">Qualified</option>
            <option value="not_qualified">Not qualified</option>
            <option value="nurture">Nurture</option>
            <option value="needs_info">Needs info</option>
          </select>
          <select name="label" defaultValue={filters.label ?? ""} className={select} aria-label="Priority">
            <option value="">All priorities</option>
            <option value="Hot">Hot</option>
            <option value="Warm">Warm</option>
            <option value="Standard">Standard</option>
          </select>
          <button className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white dark:bg-stone-100 dark:text-stone-900">Filter</button>
          {(filters.q || filters.type || filters.verdict || filters.label) && (
            <Link href="/" className="self-center text-sm text-stone-500 hover:underline">Clear</Link>
          )}
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-stone-200 text-xs text-stone-500 dark:border-stone-800">
            <tr>
              {["Time", "Caller", "Property", "Location", "Score", "Verdict / type", "Booked", "Email", "HubSpot"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {rows.map((r) => <CallTr key={r.id} r={r} />)}
            {!rows.length && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-stone-500">No calls yet. <Link href="/upload" className="text-accent hover:underline">Upload the seed PDF</Link>.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CallTr({ r }: { r: CallRow }) {
  const f = (r.fields ?? {}) as Record<string, string | number | null>;
  const pinned = r.urgent || r.record_type === "escalation";
  const name =
    (f.caller_name as string) ??
    (r.analysis_status === "error" || r.analysis_status === "pending"
      ? "Not analysed yet"
      : r.record_type === "lead" || r.record_type === "escalation"
        ? "Name not given"
        : r.caller_number ?? "Unknown caller");
  return (
    <tr className={pinned ? "bg-red-50/60 dark:bg-red-950/30" : "hover:bg-stone-50 dark:hover:bg-stone-800/40"}>
      <td className="px-3 py-2 whitespace-nowrap text-stone-600 dark:text-stone-400">
        {fmtDateTime(r.started_at)}
        {r.after_hours && <span className="ml-1 text-xs text-stone-400" title="Outside 10am–7pm">🌙</span>}
      </td>
      <td className="px-3 py-2">
        <Link href={`/calls/${r.id}`} className="font-medium hover:underline">{name}</Link>
        <div className="text-xs text-stone-400">{r.external_id}</div>
      </td>
      <td className="px-3 py-2">{(f.property_type as string) ?? (f.project as string) ?? "—"}</td>
      <td className="px-3 py-2">{(f.location as string) ?? "—"}</td>
      <td className="px-3 py-2"><ScoreBadge score={r.score} label={r.score_label} /></td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {r.urgent && <UrgentFlag />}
          {r.record_type === "lead" ? <VerdictBadge verdict={r.verdict} overridden={!!r.override_verdict} /> : <TypeBadge type={r.record_type} />}
          {r.analysis_status === "error" && <span className="text-xs text-red-600" title={r.analysis_error ?? ""}>error</span>}
        </div>
        {r.record_type === "lead" && r.verdict !== "qualified" && r.reasons?.[0] && (
          <div className="mt-0.5 max-w-xs truncate text-xs text-stone-500" title={r.reasons.join(" · ")}>{r.reasons[0]}</div>
        )}
      </td>
      <td className="px-3 py-2"><StatusDot status={r.booking_status} /></td>
      <td className="px-3 py-2"><StatusDot status={r.email_status} /></td>
      <td className="px-3 py-2"><StatusDot status={r.hubspot_status} /></td>
    </tr>
  );
}
