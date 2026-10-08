import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { generateJson, GeminiError, costInr } from "./gemini";
import { assemble } from "./analysis";
import {
  LeadOutput,
  EscalationOutput,
  leadSystemPrompt,
  escalationSystemPrompt,
  callUserPrompt,
} from "./prompts/analyse-post-call";
import { routeCall } from "./route";
import { deliver } from "./deliver";
import type { CallLeg } from "./pdfSplit";

/** Our own call shape. Vaani payloads and seed enquiries are both mapped to this. */
export type CallRecord = {
  source: "vaani" | "seed" | "simulated";
  external_id: string;
  header?: string | null;
  caller_number: string | null;
  started_at: string | null;
  duration_s: number | null;
  answer_delay_s?: number | null;
  status: "completed" | "missed" | "dropped";
  flags?: { escalate?: boolean; merged?: boolean };
  legs?: CallLeg[];
  transcript: string | null;
  notes: string | null;
  recording_url?: string | null;
  raw_payload?: unknown;
  after_hours?: boolean | null;
};

export type ProcessOutcome = {
  call_id: string;
  external_id: string;
  outcome: "processed" | "duplicate" | "merged" | "error";
  record_type: string | null;
  verdict?: string | null;
  error?: string;
};

const MERGE_WINDOW_MIN = 10;

export function contentHash(r: CallRecord): string {
  const basis = JSON.stringify([r.header ?? null, r.started_at, r.status, r.legs ?? [], r.transcript, r.notes]);
  return createHash("sha256").update(basis).digest("hex");
}

/** Outside 10:00–19:00 Asia/Kolkata. */
export function isAfterHours(iso: string | null): boolean | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  const mins = h * 60 + m;
  return mins < 600 || mins >= 1140;
}

/**
 * The single pipeline used by the post-call webhook, POST /api/process and the PDF upload.
 * 1 dedupe → 2 record type → 3 Gemini (leads/escalations) → 4 save → 5 route.
 */
export async function processCall(record: CallRecord): Promise<ProcessOutcome> {
  const db = sql();
  const hash = contentHash(record);
  const afterHours = record.after_hours ?? isAfterHours(record.started_at);

  // 1. Dedupe on (source, external_id, content_hash).
  const inserted = (await db`
    insert into calls (source, external_id, content_hash, caller_number, started_at, duration_s,
      answer_delay_s, status, transcript, notes, recording_url, legs, raw_payload, after_hours)
    values (${record.source}, ${record.external_id}, ${hash}, ${record.caller_number}, ${record.started_at},
      ${record.duration_s}, ${record.answer_delay_s ?? null}, ${record.status}, ${record.transcript},
      ${record.notes}, ${record.recording_url ?? null}, ${JSON.stringify(record.legs ?? [])},
      ${record.raw_payload === undefined ? null : JSON.stringify(record.raw_payload)}, ${afterHours})
    on conflict (source, external_id, content_hash) do nothing
    returning id`) as { id: string }[];

  let callId: string;
  if (inserted.length) {
    callId = inserted[0].id;
  } else {
    const [existing] = (await db`
      select id, analysis_status, record_type from calls
      where source = ${record.source} and external_id = ${record.external_id} and content_hash = ${hash}`) as {
      id: string;
      analysis_status: string;
      record_type: string | null;
    }[];
    // Already processed → stop. A row left 'pending'/'error' by a crash is resumed.
    if (existing.analysis_status === "done" || existing.analysis_status === "skipped") {
      return { call_id: existing.id, external_id: record.external_id, outcome: "duplicate", record_type: existing.record_type };
    }
    callId = existing.id;
  }

  try {
    // 2. Record type from metadata/header flags first (they beat Gemini).
    if (record.status === "missed") {
      await markNoConversation(callId, "missed_call");
      return { call_id: callId, external_id: record.external_id, outcome: "processed", record_type: "missed_call" };
    }
    if (record.status === "dropped") {
      const mergedInto = await mergeDroppedIntoCallback(callId, record);
      if (mergedInto) {
        return { call_id: callId, external_id: record.external_id, outcome: "merged", record_type: "dropped_call" };
      }
      await markNoConversation(callId, "dropped_call");
      return { call_id: callId, external_id: record.external_id, outcome: "processed", record_type: "dropped_call" };
    }
    // A completed call may be the callback for an earlier dropped call from the same number.
    const transcript = await absorbEarlierDropped(callId, record);

    // 3. Gemini.
    const input = callUserPrompt({
      id: record.external_id,
      header: record.header,
      started_at: record.started_at,
      duration_s: record.duration_s,
      transcript: transcript ?? "",
      notes: record.notes,
    });
    const recordType = record.flags?.escalate ? "escalation" : await analyseLead(callId, input);
    if (recordType === "escalation") await analyseEscalation(callId, input, record.flags?.escalate === true);

    // 5. Route by verdict / type, then send. Delivery failures land on their own
    // statuses (retryable from the dashboard), not on the analysis.
    const verdict = await routeCall(callId);
    await deliver(callId).catch((e) => console.error(`deliver ${callId}:`, (e as Error).message));
    return { call_id: callId, external_id: record.external_id, outcome: "processed", record_type: recordType, verdict };
  } catch (e) {
    const message = (e as Error).message;
    await db`update calls set analysis_status = 'error', analysis_error = ${message} where id = ${callId}`;
    return { call_id: callId, external_id: record.external_id, outcome: "error", record_type: null, error: message };
  }
}

async function markNoConversation(callId: string, recordType: "missed_call" | "dropped_call") {
  await sql()`
    update calls set record_type = ${recordType}, analysis_status = 'skipped',
      callback_status = coalesce(callback_status, 'pending')
    where id = ${callId}`;
}

/** Runs the full lead analysis and stores it. Returns the record type Gemini found. */
async function analyseLead(callId: string, input: string): Promise<"lead" | "escalation"> {
  try {
    const res = await generateJson({ schema: LeadOutput, system: leadSystemPrompt(), user: input });
    if (res.data.record_type === "escalation") {
      await addUnattributedSpend(callId, res.usage); // billed, but superseded by the escalation analysis
      return "escalation";
    }
    const a = assemble(res.data);
    await sql()`
      insert into analyses (call_id, kind, model, gates, verdict, score, score_breakdown, score_label, urgent,
        fields, reasons, already_known, opening_questions, handoff_notes, asked_about_price, indicative_range,
        summary, raw_output, tokens_in, tokens_out, cost_inr)
      values (${callId}, 'lead', ${res.model}, ${JSON.stringify(a.gates)}, ${a.verdict}, ${a.score},
        ${a.score_breakdown && JSON.stringify(a.score_breakdown)}, ${a.score_label}, ${a.urgent},
        ${JSON.stringify(a.fields)}, ${a.reasons}, ${a.already_known}, ${a.opening_questions}, ${a.handoff_notes},
        ${a.asked_about_price}, ${a.indicative_range}, ${a.summary},
        ${JSON.stringify({ gemini: res.data, adjustments: a.adjustments, attempts: res.attempts })},
        ${res.usage.tokens_in}, ${res.usage.tokens_out}, ${res.usage.cost_inr})`;
    await sql()`
      update calls set record_type = 'lead', analysis_status = 'done', analysis_error = null,
        callback_status = case when ${a.verdict} = 'needs_info' then coalesce(callback_status, 'pending') else callback_status end
      where id = ${callId}`;
    return "lead";
  } catch (e) {
    if (e instanceof GeminiError) await addUnattributedSpend(callId, e.usage);
    throw e;
  }
}

async function analyseEscalation(callId: string, input: string, fromHeader: boolean) {
  try {
    const res = await generateJson({ schema: EscalationOutput, system: escalationSystemPrompt(), user: input });
    const d = res.data;
    await sql()`
      insert into analyses (call_id, kind, model, urgent, fields, summary, raw_output, tokens_in, tokens_out, cost_inr)
      values (${callId}, 'escalation', ${res.model}, true, ${JSON.stringify(d)}, ${d.summary},
        ${JSON.stringify({ gemini: d, record_type_source: fromHeader ? "header" : "gemini" })},
        ${res.usage.tokens_in}, ${res.usage.tokens_out}, ${res.usage.cost_inr})`;
    await sql()`update calls set record_type = 'escalation', analysis_status = 'done', analysis_error = null where id = ${callId}`;
  } catch (e) {
    if (e instanceof GeminiError) await addUnattributedSpend(callId, e.usage);
    throw e;
  }
}

/**
 * Gemini spend that produced no stored analysis (failed or superseded attempts) is still billed.
 * Kept on the call, not as an analysis, so the cost tile stays honest without looking like a result.
 */
async function addUnattributedSpend(callId: string, usage: { tokens_in: number; tokens_out: number }) {
  if (!usage.tokens_in && !usage.tokens_out) return;
  await sql()`
    update calls set unattributed_gemini_inr = unattributed_gemini_inr + ${costInr(usage.tokens_in, usage.tokens_out)}
    where id = ${callId}`;
}

/**
 * Live calls: a dropped call followed within 10 min by a call from the same number
 * becomes one record. The dropped leg is folded into the callback's row.
 * (Seed T17 arrives pre-merged from its header, so this only runs for live calls.)
 */
async function absorbEarlierDropped(callId: string, record: CallRecord): Promise<string | null> {
  if (record.source === "seed" || !record.caller_number || !record.started_at) return record.transcript;
  const dropped = (await sql()`
    select id, started_at, duration_s, transcript from calls
    where caller_number = ${record.caller_number} and status = 'dropped' and merged_into is null and id <> ${callId}
      and started_at between ${record.started_at}::timestamptz - make_interval(mins => ${MERGE_WINDOW_MIN})
                         and ${record.started_at}::timestamptz
    order by started_at`) as { id: string; started_at: string; duration_s: number | null; transcript: string | null }[];
  if (!dropped.length) return record.transcript;

  const legs: CallLeg[] = [
    ...dropped.map((d) => ({ started_at: new Date(d.started_at).toISOString(), duration_s: d.duration_s, status: "dropped" as const })),
    { started_at: record.started_at, duration_s: record.duration_s, status: "completed" as const },
  ];
  const transcript = [
    ...dropped.map((d, i) => `[Call ${i + 1} — dropped]\n${d.transcript ?? "(no transcript)"}`),
    `[Call ${dropped.length + 1} — callback]\n${record.transcript ?? ""}`,
  ].join("\n\n");
  await sql()`
    update calls set legs = ${JSON.stringify(legs)}, transcript = ${transcript},
      started_at = ${legs[0].started_at}, duration_s = ${legs.reduce((s, l) => s + (l.duration_s ?? 0), 0)}
    where id = ${callId}`;
  await sql()`
    update calls set merged_into = ${callId}, record_type = 'dropped_call', analysis_status = 'skipped', callback_status = 'done'
    where id = any(${dropped.map((d) => d.id)})`;
  return transcript;
}

/** Out-of-order webhooks: the callback was processed before this dropped call arrived. */
async function mergeDroppedIntoCallback(callId: string, record: CallRecord): Promise<string | null> {
  if (record.source === "seed" || !record.caller_number || !record.started_at) return null;
  const [callback] = (await sql()`
    select id from calls
    where caller_number = ${record.caller_number} and status = 'completed' and id <> ${callId}
      and started_at between ${record.started_at}::timestamptz
                         and ${record.started_at}::timestamptz + make_interval(mins => ${MERGE_WINDOW_MIN})
    order by started_at limit 1`) as { id: string }[];
  if (!callback) return null;
  await sql()`
    update calls set merged_into = ${callback.id}, record_type = 'dropped_call', analysis_status = 'skipped', callback_status = 'done'
    where id = ${callId}`;
  return callback.id;
}

/**
 * Dashboard "Re-run Gemini": a fresh analysis is appended (history kept), then the
 * call is re-routed. Deliveries already done stay done; nothing is sent twice.
 */
export async function rerunAnalysis(callId: string): Promise<ProcessOutcome> {
  const [c] = (await sql()`
    select id, external_id, header, started_at, duration_s, transcript, notes, record_type, raw_payload
    from (select c.*, c.raw_payload->>'header' as header from calls c) c where id = ${callId}`) as {
    id: string;
    external_id: string;
    header: string | null;
    started_at: string | null;
    duration_s: number | null;
    transcript: string | null;
    notes: string | null;
    record_type: string | null;
  }[];
  if (!c) throw new Error("call not found");
  if (!c.transcript || c.record_type === "missed_call" || c.record_type === "dropped_call")
    return { call_id: callId, external_id: c.external_id, outcome: "duplicate", record_type: c.record_type, error: "No conversation to analyse" };
  try {
    const input = callUserPrompt({
      id: c.external_id,
      header: c.header,
      started_at: c.started_at ? new Date(c.started_at).toISOString() : null,
      duration_s: c.duration_s,
      transcript: c.transcript,
      notes: c.notes,
    });
    const recordType = c.record_type === "escalation" ? "escalation" : await analyseLead(callId, input);
    if (recordType === "escalation") await analyseEscalation(callId, input, c.record_type === "escalation");
    const verdict = await routeCall(callId);
    await deliver(callId).catch((e) => console.error(`deliver ${callId}:`, (e as Error).message));
    return { call_id: callId, external_id: c.external_id, outcome: "processed", record_type: recordType, verdict };
  } catch (e) {
    const message = (e as Error).message;
    await sql()`update calls set analysis_status = 'error', analysis_error = ${message} where id = ${callId}`;
    return { call_id: callId, external_id: c.external_id, outcome: "error", record_type: c.record_type, error: message };
  }
}

/** Nikhil's human check. Overriding to qualified triggers the email and HubSpot (once). */
export async function overrideVerdict(callId: string, newVerdict: "qualified" | "not_qualified" | "nurture" | "needs_info", note: string | null) {
  const [c] = (await sql()`select verdict, record_type from call_overview where id = ${callId}`) as { verdict: string | null; record_type: string | null }[];
  if (!c) throw new Error("call not found");
  if (c.record_type !== "lead") throw new Error("Only leads have a verdict to override");
  await sql()`insert into overrides (call_id, old_verdict, new_verdict, note) values (${callId}, ${c.verdict}, ${newVerdict}, ${note})`;
  const verdict = await routeCall(callId);
  const delivered = await deliver(callId);
  return { verdict, delivered };
}
