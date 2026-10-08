-- Gemini spend with no stored analysis (failed attempts, superseded lead→escalation), still billed.
alter table calls add column unattributed_gemini_inr numeric(12, 4) not null default 0;

drop view call_overview;
create view call_overview as
select
  c.*,
  a.id                as analysis_id,
  a.kind              as analysis_kind,
  a.model,
  a.gates,
  a.verdict           as ai_verdict,
  o.new_verdict       as override_verdict,
  o.note              as override_note,
  coalesce(o.new_verdict, a.verdict) as verdict,
  a.score,
  a.score_breakdown,
  a.score_label,
  coalesce(a.urgent, false) as urgent,
  a.fields,
  a.reasons,
  a.already_known,
  a.opening_questions,
  a.handoff_notes,
  a.asked_about_price,
  a.indicative_range,
  a.summary,
  coalesce(t.tokens_in, 0)  as tokens_in,
  coalesce(t.tokens_out, 0) as tokens_out,
  coalesce(t.cost_inr, 0) + c.unattributed_gemini_inr as gemini_cost_inr
from calls c
left join lateral (
  select * from analyses x where x.call_id = c.id order by x.created_at desc limit 1
) a on true
left join lateral (
  select * from overrides y where y.call_id = c.id order by y.created_at desc limit 1
) o on true
left join lateral (
  select sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out, sum(cost_inr) as cost_inr
  from analyses z where z.call_id = c.id
) t on true;
