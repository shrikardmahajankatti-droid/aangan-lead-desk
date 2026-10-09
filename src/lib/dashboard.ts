import "server-only";
import { sql } from "./db";
import { env } from "./env";

export type CallRow = {
  id: string;
  source: string;
  external_id: string;
  started_at: string | null;
  duration_s: number | null;
  status: string;
  record_type: string | null;
  after_hours: boolean | null;
  caller_number: string | null;
  analysis_status: string;
  analysis_error: string | null;
  callback_status: string | null;
  email_status: string;
  hubspot_status: string;
  booking_status: string;
  verdict: string | null;
  ai_verdict: string | null;
  override_verdict: string | null;
  score: number | null;
  score_label: string | null;
  urgent: boolean;
  fields: Record<string, unknown> | null;
  reasons: string[] | null;
  summary: string | null;
};

/** Calls shown on the dashboard: merged dropped legs are folded into their callback. */
export async function listCalls(f: { q?: string; verdict?: string; type?: string; label?: string }): Promise<CallRow[]> {
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  return (await sql()`
    select id, source, external_id, started_at, duration_s, status, record_type, after_hours, caller_number,
      analysis_status, analysis_error, callback_status, email_status, hubspot_status, booking_status,
      verdict, ai_verdict, override_verdict, score, score_label, urgent, fields, reasons, summary
    from call_overview
    where merged_into is null
      and (${q}::text is null
           or external_id ilike ${q} or caller_number ilike ${q}
           or fields->>'caller_name' ilike ${q} or fields->>'location' ilike ${q}
           or fields->>'property_type' ilike ${q} or transcript ilike ${q})
      and (${f.verdict ?? null}::text is null or verdict = ${f.verdict ?? null})
      and (${f.type ?? null}::text is null or record_type = ${f.type ?? null})
      and (${f.label ?? null}::text is null or score_label = ${f.label ?? null})
    order by
      coalesce(urgent or record_type = 'escalation', false) desc,  -- pinned: urgent leads and escalations
      started_at desc nulls last`) as CallRow[];
}

export async function callbackList(): Promise<CallRow[]> {
  return (await sql()`
    select id, source, external_id, started_at, duration_s, status, record_type, after_hours, caller_number,
      analysis_status, analysis_error, callback_status, email_status, hubspot_status, booking_status,
      verdict, ai_verdict, override_verdict, score, score_label, urgent, fields, reasons, summary
    from call_overview
    where merged_into is null and callback_status = 'pending'
    order by started_at desc nulls last`) as CallRow[];
}

export type Kpis = {
  calls: number;
  answeredWithin5: number;
  answeredKnown: number;
  afterHours: number;
  leads: number;
  qualified: number;
  hot: number;
  warm: number;
  standard: number;
  urgent: number;
  bookings: number;
  bookingsDryRun: number;
  emailsSent: number;
  emailsDryRun: number;
  hubspotSynced: number;
  hubspotDryRun: number;
  escalations: number;
  callbacks: number;
  outOfScope: number;
  errors: number;
  cost: { vaaniMinutes: number; vaaniInr: number; geminiInr: number; tokensIn: number; tokensOut: number; totalInr: number; perQualifiedInr: number | null };
};

export async function kpis(): Promise<Kpis> {
  const [k] = (await sql()`
    select
      count(*)::int                                                         as calls,
      count(*) filter (where status <> 'missed' and coalesce(answer_delay_s, 0) <= 300)::int as answered_within_5,
      count(*)::int                                                         as answered_known,
      count(*) filter (where after_hours)::int                              as after_hours,
      count(*) filter (where record_type = 'lead')::int                     as leads,
      count(*) filter (where record_type = 'lead' and verdict = 'qualified')::int as qualified,
      count(*) filter (where verdict = 'qualified' and score_label = 'Hot')::int      as hot,
      count(*) filter (where verdict = 'qualified' and score_label = 'Warm')::int     as warm,
      count(*) filter (where verdict = 'qualified' and score_label = 'Standard')::int as standard,
      count(*) filter (where urgent and record_type = 'lead')::int          as urgent,
      count(*) filter (where record_type = 'escalation')::int               as escalations,
      count(*) filter (where callback_status = 'pending')::int              as callbacks,
      count(*) filter (where analysis_status = 'error')::int                as errors,
      count(*) filter (where hubspot_status = 'done')::int                  as hubspot_synced,
      count(*) filter (where hubspot_status = 'dry_run')::int               as hubspot_dry_run
    from call_overview where merged_into is null`) as Record<string, number>[];

  const [spend] = (await sql()`
    select
      -- post-call analyses (incl. re-runs and failed attempts) + mid-call qualify checks
      (coalesce(sum(gemini_cost_inr), 0) + (select coalesce(sum(cost_inr), 0) from live_tool_calls))::float as gemini_inr,
      (coalesce(sum(tokens_in), 0) + (select coalesce(sum(tokens_in), 0) from live_tool_calls))::int        as tokens_in,
      (coalesce(sum(tokens_out), 0) + (select coalesce(sum(tokens_out), 0) from live_tool_calls))::int      as tokens_out,
      -- Vaani bills whole minutes per call; only real Vaani calls cost anything
      coalesce(sum(case when source = 'vaani' then ceil(coalesce(duration_s, 0) / 60.0) else 0 end), 0)::int as vaani_minutes
    from call_overview`) as Record<string, number>[];

  const [actions] = (await sql()`
    select
      count(*) filter (where type in ('email', 'escalation') and status = 'success')::int as emails_sent,
      -- dry runs that were later sent for real aren't "pending" any more
      count(*) filter (where type in ('email', 'escalation') and status = 'dry_run'
        and not exists (select 1 from actions s where s.idempotency_key = a.idempotency_key and s.status = 'success'))::int as emails_dry_run
    from actions a`) as Record<string, number>[];

  const [book] = (await sql()`
    select count(*) filter (where status = 'booked')::int as booked, count(*) filter (where status = 'dry_run')::int as dry_run
    from bookings`) as Record<string, number>[];

  // Out-of-scope channels: counted per distinct uploaded file (re-uploads don't double count).
  const [oos] = (await sql()`select coalesce(sum(whatsapp + web_form), 0)::int as n from seed_uploads`) as { n: number }[];

  let rate = 0;
  try {
    rate = env("costs").VAANI_COST_PER_MIN;
  } catch {}
  const vaaniInr = spend.vaani_minutes * rate;
  const totalInr = vaaniInr + spend.gemini_inr;

  return {
    calls: k.calls,
    answeredWithin5: k.answered_within_5,
    answeredKnown: k.answered_known,
    afterHours: k.after_hours,
    leads: k.leads,
    qualified: k.qualified,
    hot: k.hot,
    warm: k.warm,
    standard: k.standard,
    urgent: k.urgent,
    bookings: book.booked,
    bookingsDryRun: book.dry_run,
    emailsSent: actions.emails_sent,
    emailsDryRun: actions.emails_dry_run,
    hubspotSynced: k.hubspot_synced,
    hubspotDryRun: k.hubspot_dry_run,
    escalations: k.escalations,
    callbacks: k.callbacks,
    outOfScope: oos.n,
    errors: k.errors,
    cost: {
      vaaniMinutes: spend.vaani_minutes,
      vaaniInr,
      geminiInr: spend.gemini_inr,
      tokensIn: spend.tokens_in,
      tokensOut: spend.tokens_out,
      totalInr,
      perQualifiedInr: k.qualified ? totalInr / k.qualified : null,
    },
  };
}

export type CallDetail = CallRow & {
  transcript: string | null;
  notes: string | null;
  recording_url: string | null;
  legs: { started_at: string; duration_s: number | null; status: string }[];
  gates: Record<string, { result: string; evidence: string }> | null;
  score_breakdown: Record<string, number> | null;
  opening_questions: string[] | null;
  handoff_notes: string[] | null;
  already_known: string | null;
  asked_about_price: boolean | null;
  indicative_range: string | null;
  override_note: string | null;
  analysis_kind: string | null;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  gemini_cost_inr: string;
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  merged_into: string | null;
};

export async function getCall(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [call] = (await sql()`select * from call_overview where id = ${id}`) as CallDetail[];
  if (!call) return null;
  const [bookings, actions, overrides, mergedLegs] = await Promise.all([
    sql()`select * from bookings where call_id = ${id} order by created_at desc`,
    sql()`select id, type, status, external_id, error, created_at, payload from actions where call_id = ${id} order by created_at desc`,
    sql()`select * from overrides where call_id = ${id} order by created_at desc`,
    sql()`select id, external_id, started_at, duration_s from calls where merged_into = ${id} order by started_at`,
  ]);
  return { call, bookings, actions, overrides, mergedLegs } as {
    call: CallDetail;
    bookings: Record<string, any>[];
    actions: Record<string, any>[];
    overrides: Record<string, any>[];
    mergedLegs: Record<string, any>[];
  };
}
