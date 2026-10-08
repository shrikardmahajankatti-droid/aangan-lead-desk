import "server-only";
import { z } from "zod";
import { ThinkingLevel } from "@google/genai";
import { generateJson, GeminiError, costInr } from "./gemini";
import { contextBundle } from "./context";
import { budgetGate, decideVerdict, type Gates } from "./scoring";
import type { QualifyResult } from "./vaani/types";

// Lines the agent says, verbatim from qualification_logic.md "On the live call"
// unless marked (ours) — those situations are described there but not scripted.
export const LINES = {
  outOfArea:
    "We only work in Pune and PCMC at the moment. We don't have our contractor network outside, so we wouldn't be able to do it well.",
  adviceOnly:
    "We're a full-service studio, so our projects include design and execution together. If you plan a full redesign later, we'd love to help.",
  budgetLow:
    "Thank you for sharing that. For that scope with full execution, the budget would be well below what a project like this costs with us. I wouldn't want to bring you in if the numbers don't align.",
  twoOrMore:
    "This sounds like it may not be the right fit for us right now, but feel free to reach out if your timeline or scope changes.",
  // (ours) "Timeline too short: say so honestly, and offer a later start"
  timelineShort:
    "Honestly, our design phase alone takes three to four weeks and execution follows, so we couldn't do justice to it in that time. If a later start works for you, we'd be glad to help.",
  // (ours) from services.md "What we don't do"
  outOfServices:
    "That's outside what we take on. We focus on homes and offices, with design and execution together, so we wouldn't be the right studio for this one.",
  escalation:
    "I'm really sorry about this. I've noted your details, and a senior person from our team will call you back within 15 minutes.",
  qualified: "This sounds like a great fit for us. Let me find you a time for a free consultation with our designer.",
  fallback: "Let me have a designer call you to confirm a time.",
  ask: {
    real_project: "Are you looking for design and full execution, or mainly design advice?",
    service_area: "Which area in Pune is the property in?",
    timeline: "When would you need the project complete?",
  },
} as const;

const gate = z.object({ result: z.enum(["pass", "fail", "unclear"]), evidence: z.string() });
const LiveOutput = z.object({
  real_project: gate.extend({ out_of_services: z.boolean().describe("true if it fails because the project type is one we don't do (restaurant, hotel, retail, gym, structural, Vastu-only, furniture-only)") }),
  service_area: gate,
  timeline: gate,
  decision_maker: gate,
  nurture_eligible: z.boolean(),
});

// Vaani custom-tool parameters may arrive as strings ("1200", "true", ""), so coerce carefully:
// "" / "null" / "unknown" → null; "false"/"no" → false (z.coerce.boolean would make it true).
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && /^\s*(|null|none|unknown|n\/a)\s*$/i.test(v));
const optNum = z.preprocess((v) => {
  if (blank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]|sq\s*ft|lakh|l$/gi, ""));
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());
const optInt = z.preprocess((v) => {
  if (blank(v)) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.round(n) : null;
}, z.number().int().nullable());
const optBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (blank(v)) return null;
  return /^(true|yes|y|1)$/i.test(String(v).trim());
}, z.boolean().nullable());
const optStr = z.preprocess((v) => (blank(v) ? null : String(v)), z.string().nullable());
const lowerOrNull = (v: unknown) => (blank(v) ? null : String(v).trim().toLowerCase());
const scopeExtent = z.preprocess(lowerOrNull, z.enum(["full", "partial", "unknown"]).nullable().catch(null));
const segmentEnum = z.preprocess(lowerOrNull, z.enum(["residential", "commercial"]).nullable().catch(null));

export const LiveArgs = z.object({
  caller_name: optStr.optional(),
  location: optStr.optional(),
  property_type: optStr.optional(),
  sq_ft: optNum.optional(),
  bhk: optInt.optional(),
  scope: optStr.optional(),
  scope_extent: scopeExtent.optional(),
  rooms_in_scope: optInt.optional(),
  segment: segmentEnum.optional(),
  timeline: optStr.optional(),
  decision_maker: optStr.optional(),
  volunteered_budget_lakh: optNum.optional(),
  is_existing_client_complaint: optBool.optional(),
  notes: optStr.optional(),
});
export type LiveArgs = z.infer<typeof LiveArgs>;

const SYSTEM = () =>
  `You make a fast mid-call check of a phone enquiry for Aangan Studio against qualification_logic.md Step 1, using only the fields collected so far.
Judge gates 1 (real project in scope), 2 (service area), 3 (timeline) and 5 (decision-maker). Budget is handled elsewhere.
A field that hasn't been collected yet makes its gate "unclear", except: no deadline stated → timeline "pass"; Gate 5 is "unclear" unless the caller confirmed they decide.
Kharadi and all Pune city/PCMC areas are in area. Commercial spaces under ~500 sq ft fail Gate 1. Possessive phrasing alone does not confirm a decision-maker.
Evidence = the field value you relied on.

${contextBundle({ stripCalibration: true })}`;

/** Step 0 + Step 1 for the live call. Never throws: on any failure returns the designer-callback fallback. */
export type LiveQualifyOutcome = {
  result: QualifyResult;
  usage: { tokens_in: number; tokens_out: number; cost_inr: number };
  gates?: Gates;
  degraded?: string;
};

export async function liveQualify(args: LiveArgs, timeoutMs = 2500): Promise<LiveQualifyOutcome> {
  const usage = { tokens_in: 0, tokens_out: 0, cost_inr: 0 };
  const done = (result: QualifyResult, extra: Partial<LiveQualifyOutcome> = {}): LiveQualifyOutcome => ({ result, usage, ...extra });
  if (args.is_existing_client_complaint) {
    return done({ record_type: "escalation", verdict: "unknown", reason_for_agent: LINES.escalation, offer_booking: false });
  }

  let out: z.infer<typeof LiveOutput>;
  try {
    const res = await generateJson({
      schema: LiveOutput,
      system: SYSTEM(),
      user: `Fields collected so far:\n${JSON.stringify(args, null, 2)}`,
      timeoutMs,
      thinking: ThinkingLevel.LOW, // 3.8 Flash rejects MINIMAL
      transientRetries: 0, // no time to retry mid-call
      maxWaitMs: 0,
      fallback: false,
      validationRetries: 0,
    });
    out = res.data;
    Object.assign(usage, res.usage);
  } catch (e) {
    if (e instanceof GeminiError) Object.assign(usage, { ...e.usage, cost_inr: costInr(e.usage.tokens_in, e.usage.tokens_out) });
    return done(
      { record_type: "lead", verdict: "unknown", reason_for_agent: LINES.fallback, offer_booking: false },
      { degraded: (e as Error).message.slice(0, 200) },
    );
  }

  const budget =
    budgetGate({
      segment: args.segment ?? null,
      sq_ft: args.sq_ft ?? null,
      bhk: args.bhk ?? null,
      scope_extent: args.scope_extent ?? "unknown",
      rooms_in_scope: args.rooms_in_scope ?? null,
      budget_max_lakh: args.volunteered_budget_lakh ?? null,
    }) ?? "pass";
  const gates: Gates = {
    real_project: out.real_project,
    service_area: out.service_area,
    timeline: out.timeline,
    budget: { result: budget, evidence: args.volunteered_budget_lakh ? `₹${args.volunteered_budget_lakh} L` : "No budget mentioned" },
    decision_maker: out.decision_maker,
  };
  const verdict = decideVerdict(gates, out.nurture_eligible);
  const fails = Object.values(gates).filter((g) => g.result === "fail").length;

  if (verdict === "qualified") return done({ record_type: "lead", verdict, reason_for_agent: LINES.qualified, offer_booking: true }, { gates });

  if (verdict === "needs_info") {
    const unclear = (["real_project", "service_area", "timeline"] as const).find((k) => gates[k].result === "unclear")!;
    return done({ record_type: "lead", verdict, unclear_gate: unclear, ask_next: LINES.ask[unclear], reason_for_agent: LINES.ask[unclear], offer_booking: false }, { gates });
  }

  // not_qualified / nurture: the matching close line
  if (fails >= 2) return done({ record_type: "lead", verdict, reason_for_agent: LINES.twoOrMore, offer_booking: false }, { gates });
  if (gates.service_area.result === "fail") return done({ record_type: "out_of_area", verdict, reason_for_agent: LINES.outOfArea, offer_booking: false }, { gates });
  if (gates.real_project.result === "fail")
    return done(
      out.real_project.out_of_services
        ? { record_type: "out_of_services", verdict, reason_for_agent: LINES.outOfServices, offer_booking: false }
        : { record_type: "lead", verdict, reason_for_agent: LINES.adviceOnly, offer_booking: false },
      { gates },
    );
  if (gates.budget.result === "fail") return done({ record_type: "lead", verdict, reason_for_agent: LINES.budgetLow, offer_booking: false }, { gates });
  if (gates.timeline.result === "fail") return done({ record_type: "lead", verdict, reason_for_agent: LINES.timelineShort, offer_booking: false }, { gates });
  return done({ record_type: "lead", verdict, reason_for_agent: LINES.twoOrMore, offer_booking: false }, { gates });
}
