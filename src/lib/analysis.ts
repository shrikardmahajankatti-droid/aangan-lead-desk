// Turns Gemini's LeadOutput into the stored analysis: enforces the evidence rule,
// recomputes Gate 4 from pricing, applies the decision rules, and scores in code.
// Pure (no I/O) so it is unit-tested directly.
import type { LeadOutput } from "./prompts/analyse-post-call";
import {
  budgetGate,
  completenessPoint,
  decideVerdict,
  indicativeRange,
  scoreLabel,
  valuePoints,
  type Gates,
  type ScoreLabel,
  type ValueInputs,
  type Verdict,
} from "./scoring";

export type Fields = {
  caller_name: string | null;
  phone: string | null;
  property_type: string | null;
  location: string | null;
  sq_ft: number | null;
  bhk: number | null;
  segment: "residential" | "commercial" | null;
  scope: string | null;
  scope_extent: "full" | "partial" | "unknown";
  rooms_in_scope: number | null;
  budget_band: string | null;
  timeline: string | null;
  decision_maker: string | null;
};

export type ScoreBreakdown = { value: number; readiness: number; commitment: number; source: number; completeness: number };

export type Assembled = {
  record_type: "lead" | "escalation";
  fields: Fields;
  gates: Gates;
  verdict: Verdict;
  score: number | null;
  score_breakdown: ScoreBreakdown | null;
  score_label: ScoreLabel | null;
  urgent: boolean;
  reasons: string[];
  already_known: string;
  opening_questions: string[];
  handoff_notes: string[];
  asked_about_price: boolean;
  indicative_range: string | null;
  summary: string;
  adjustments: string[]; // where code overrode Gemini, for the audit trail
};

const DEFAULT_PASS_EVIDENCE = { timeline: "No deadline stated", budget: "No budget mentioned" };

export function assemble(out: LeadOutput): Assembled {
  const adjustments: string[] = [];
  const gates = structuredClone(out.gates) as Gates;

  // Evidence rule: a "pass" with no evidence is "unclear" — except the two rulebook defaults.
  for (const key of ["real_project", "service_area", "decision_maker"] as const) {
    if (gates[key].result === "pass" && !gates[key].evidence.trim()) {
      gates[key] = { result: "unclear", evidence: "" };
      adjustments.push(`${key}: pass without evidence → unclear`);
    }
  }
  if (gates.timeline.result === "pass" && !gates.timeline.evidence.trim())
    gates.timeline.evidence = DEFAULT_PASS_EVIDENCE.timeline;

  const value: ValueInputs = {
    segment: out.segment,
    sq_ft: out.sq_ft,
    bhk: out.bhk,
    scope_extent: out.scope_extent,
    rooms_in_scope: out.rooms_in_scope,
    budget_max_lakh: out.budget_max_lakh,
  };

  // Gate 4 is arithmetic against pricing.md: code decides when it can.
  const budget = budgetGate(value);
  if (budget && budget !== gates.budget.result) {
    adjustments.push(`budget: ${gates.budget.result} → ${budget} (pricing check)`);
    gates.budget = {
      result: budget,
      evidence: gates.budget.evidence || (out.budget_max_lakh === null ? DEFAULT_PASS_EVIDENCE.budget : ""),
    };
  }
  if (!gates.budget.evidence.trim() && out.budget_max_lakh === null) gates.budget.evidence = DEFAULT_PASS_EVIDENCE.budget;

  const verdict = decideVerdict(gates, out.nurture_eligible);

  const handoff_notes = [...out.handoff_notes];
  if (gates.budget.result === "pass_tight" && !handoff_notes.some((n) => /tight/i.test(n)))
    handoff_notes.push("Budget may be tight for this scope");
  if (gates.decision_maker.result === "unclear" && !handoff_notes.some((n) => /decision/i.test(n)))
    handoff_notes.push("Decision-maker not confirmed");

  let score: number | null = null;
  let score_breakdown: ScoreBreakdown | null = null;
  let label: ScoreLabel | null = null;
  if (verdict === "qualified") {
    score_breakdown = {
      value: valuePoints(value),
      readiness: Math.max(0, Math.min(2, out.readiness)),
      commitment: (out.consultation_agreed ? 1 : 0) + (gates.decision_maker.result === "pass" ? 1 : 0),
      source: out.source_referral ? 1 : 0,
      completeness: completenessPoint({
        location: out.location,
        scope: out.scope,
        sq_ft: out.sq_ft,
        bhk: out.bhk,
        timeline: out.timeline,
      }),
    };
    score = Object.values(score_breakdown).reduce((a, b) => a + b, 0);
    label = scoreLabel(score);
  }

  return {
    record_type: out.record_type,
    fields: {
      caller_name: out.caller_name,
      phone: out.phone,
      property_type: out.property_type,
      location: out.location,
      sq_ft: out.sq_ft,
      bhk: out.bhk,
      segment: out.segment,
      scope: out.scope,
      scope_extent: out.scope_extent,
      rooms_in_scope: out.rooms_in_scope,
      budget_band: out.budget_band,
      timeline: out.timeline,
      decision_maker: out.decision_maker,
    },
    gates,
    verdict,
    score,
    score_breakdown,
    score_label: label,
    urgent: out.urgent,
    reasons: out.reasons.slice(0, 3),
    already_known: out.already_known,
    opening_questions: out.opening_questions,
    handoff_notes,
    asked_about_price: out.asked_about_price,
    indicative_range: indicativeRange(value),
    summary: out.summary,
    adjustments,
  };
}
