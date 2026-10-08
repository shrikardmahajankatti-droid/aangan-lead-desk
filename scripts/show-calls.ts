// Prints the stored result for seed enquiries as JSON (the §7 shape), plus the gate/score detail.
// Usage: npm run show -- T01 T03 T08
import { sql } from "../src/lib/db";

const ids = process.argv.slice(2);
const rows = (await sql()`
  select * from call_overview where source = 'seed' and external_id = any(${ids}) and merged_into is null
  order by external_id`) as Record<string, any>[];

for (const r of rows) {
  const f = r.fields ?? {};
  const out = r.analysis_kind === "lead"
    ? {
        record_type: r.record_type,
        caller_name: f.caller_name, phone: f.phone, property_type: f.property_type, location: f.location,
        sq_ft: f.sq_ft, scope: f.scope, budget_band: f.budget_band, timeline: f.timeline, decision_maker: f.decision_maker,
        gates: r.gates, verdict: r.verdict, score: r.score, score_breakdown: r.score_breakdown, score_label: r.score_label,
        urgent: r.urgent, reasons: r.reasons, already_known: r.already_known, opening_questions: r.opening_questions,
        asked_about_price: r.asked_about_price, indicative_range: r.indicative_range, handoff_notes: r.handoff_notes,
        summary: r.summary,
      }
    : r.analysis_kind === "escalation"
      ? { record_type: r.record_type, urgent: true, ...f }
      : { record_type: r.record_type, status: r.status, callback_status: r.callback_status, after_hours: r.after_hours };
  const meta = {
    started_at: r.started_at, duration_s: r.duration_s, after_hours: r.after_hours, legs: r.legs,
    email_status: r.email_status, hubspot_status: r.hubspot_status, booking_status: r.booking_status,
    tokens: `${r.tokens_in} in / ${r.tokens_out} out`, gemini_cost_inr: Number(r.gemini_cost_inr).toFixed(3),
  };
  console.log(`\n===== ${r.external_id} =====`);
  console.log(JSON.stringify({ ...out, _meta: meta }, null, 2));
}
