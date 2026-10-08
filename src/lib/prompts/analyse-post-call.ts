import "server-only";
import { z } from "zod";
import { contextBundle } from "../context";

const str = z.string().nullable();
const gate = z.object({
  result: z.enum(["pass", "fail", "unclear"]),
  evidence: z.string().describe("Short quote or fact from the transcript/notes; empty string if none"),
});

/** What Gemini returns for a lead. Scoring arithmetic and the verdict are done in code (scoring.ts). */
export const LeadOutput = z.object({
  record_type: z.enum(["lead", "escalation"]).describe("escalation = existing client complaining about an ongoing project"),
  caller_name: str,
  phone: str.describe("Only if digits appear in the transcript; '(gives number)' is null"),
  property_type: str.describe("e.g. '3BHK apartment', 'villa', 'office'"),
  location: str.describe("Area/locality as said, e.g. 'Kothrud (Dahanukar Colony)'"),
  sq_ft: z.number().nullable().describe("Stated carpet/area in sq ft; null if not stated"),
  bhk: z.number().int().nullable(),
  segment: z.enum(["residential", "commercial"]).nullable(),
  scope: str.describe("Rooms/areas in scope, e.g. 'kitchen, wardrobes, living room'"),
  scope_extent: z
    .enum(["full", "partial", "unknown"])
    .describe("full = whole home/office (said 'full', 'whole', 'complete', 'entire', 'end-to-end', 'full package', or the desk calls it full-home scope); partial = specific rooms only; unknown = not described"),
  rooms_in_scope: z.number().int().nullable().describe("Count of rooms for partial scope (kitchen=1, each bedroom=1, living=1)"),
  budget_band: str.describe("Only a budget the caller volunteered, verbatim-ish, e.g. '₹1–1.5 lakh'"),
  budget_max_lakh: z.number().nullable().describe("Upper bound of a volunteered budget in lakh; null if none"),
  timeline: str,
  decision_maker: str.describe("Who decides, as stated"),
  gates: z.object({
    real_project: gate,
    service_area: gate,
    timeline: gate,
    budget: z.object({ result: z.enum(["pass", "pass_tight", "fail"]), evidence: z.string() }),
    decision_maker: gate,
  }),
  nurture_eligible: z
    .boolean()
    .describe("True only if the single failing reason is timing, or the caller is just exploring/advice-only for now and open to a full project later"),
  readiness: z.number().int().min(0).max(2),
  consultation_agreed: z.boolean(),
  source_referral: z.boolean().describe("Referred by a past client, Nikhil's contact or a builder partner"),
  urgent: z.boolean().describe("Caller frustrated by an earlier missed follow-up"),
  reasons: z.array(z.string()).max(3).describe("Max 3, each naming the gate or score dimension it comes from"),
  already_known: z.string().describe("One line: what the caller already told us"),
  opening_questions: z.array(z.string()).length(3).describe("Exactly 3, about things NOT already answered. Never about price/budget."),
  asked_about_price: z.boolean(),
  handoff_notes: z.array(z.string()).describe("Uncertainties for the designer, e.g. 'decision-maker not confirmed'"),
  summary: z.string().describe("2-line requirement summary"),
});
export type LeadOutput = z.infer<typeof LeadOutput>;

/** Short extraction for escalations (no gates, no score): feeds the urgent email to Nikhil. */
export const EscalationOutput = z.object({
  caller_name: str,
  phone: str,
  project: str.describe("Existing project: property, location, assigned designer"),
  complaint: z.string(),
  callback_request: str.describe("e.g. 'wants a call from Nikhil or a senior person'"),
  summary: z.string().describe("2 lines"),
});
export type EscalationOutput = z.infer<typeof EscalationOutput>;

const RULES = `
You analyse one phone enquiry for Aangan Studio, an interior design studio in Pune.
The rulebook is qualification_logic.md (Steps 0–2), with services.md, pricing.md and qualified.md as reference.

General rules
- Use only facts in the transcript and its notes. If something is missing, use null. Never invent a name, phone number, size or budget.
- Every gate's "evidence" must be a short quote or fact from the transcript/notes. If there is no evidence, the gate is "unclear", never "pass" — except the two defaults below.
- Notes (lines starting "Note:") are written by staff and count as evidence.

Gate clarifications (confirmed with the studio; apply exactly)
- Gate 1 real_project: a residential home or office enquiry passes unless the caller explicitly wants only advice/ideas/suggestions, decor/styling, standalone furniture, Vastu-only, structural work, or will do execution themselves. Restaurants, hotels, retail and gyms fail. A commercial space under ~500 sq ft fails (below workable scope).
- Gate 2 service_area: Pune city and PCMC pass, including Kharadi and the areas listed. Talegaon, Lonavala, Nashik, Mumbai and other cities fail.
- Gate 3 timeline: no deadline stated → "pass" (evidence: "No deadline stated"). Move-in or target dates are soft unless the caller says they are fixed. A client who prefers a later start passes. A hard deadline under ~6 weeks away fails. A hard deadline ~6–11 weeks away is "unclear".
- Gate 4 budget: never infer a budget. No budget mentioned → "pass" (evidence: "No budget mentioned"). If the caller volunteered a figure, fill budget_band and budget_max_lakh; the comparison against pricing is done in code, so give your best result but it may be overridden.
- Gate 5 decision_maker: "pass" only if the caller explicitly confirms they are the owner/decider, are authorised ("my husband said go ahead"), are the tenant of their own home, or are the founder. Possessive phrasing alone ("my flat", "we have a 3BHK") is "unclear". Calling for someone else who will decide is "unclear". Research for others with no authorisation and no plan for them to engage is "fail".

Score inputs (Step 2; the arithmetic is done in code)
- readiness is about when DESIGN can start: 2 = site is ready or accessible within ~6 weeks AND the caller wants design to begin within ~6 weeks ("right away", "from next month", or a completion target that implies starting now); 1 = start explicitly deferred further out (e.g. "January start"), or no timing stated; 0 = vague/someday.
- consultation_agreed: the caller agreed to or asked for a consultation/site visit, or the desk proceeded to book one without objection. Merely leaving a number to "note details" is false.
- source_referral: referred by a past client, Nikhil's own contact, or a builder partner. Instagram/LinkedIn/Google is false.
- scope_extent / rooms_in_scope / segment / bhk / sq_ft feed the value estimate.

Record type
- "escalation" if the caller is an existing client with a complaint about an ongoing project. Otherwise "lead".
- urgent = true if the caller is frustrated by an earlier missed follow-up (e.g. "I called Monday, no one got back").

Output
- reasons: at most 3, each tied to a gate or score dimension, e.g. "Gate 2: Nashik is outside Pune/PCMC".
- opening_questions: exactly 3 questions the designer should open with, about things NOT already answered. Never about price or budget.
- Never state or estimate a price anywhere in your output.
`.trim();

export function leadSystemPrompt(): string {
  return `${RULES}\n\n# Rulebook and reference files\n\n${contextBundle({ stripCalibration: true })}`;
}

export function escalationSystemPrompt(): string {
  return `You summarise an escalation call for Aangan Studio's studio head: an existing client complaining about an ongoing project. Use only facts in the transcript and notes; null if missing; never invent names or numbers.`;
}

export function callUserPrompt(input: {
  id: string;
  header?: string | null;
  started_at: string | null;
  duration_s: number | null;
  transcript: string;
  notes: string | null;
}): string {
  return [
    `Enquiry ${input.id}`,
    input.header ? `Header: ${input.header}` : null,
    input.started_at ? `Call time (IST): ${input.started_at}` : null,
    input.duration_s ? `Duration: ${input.duration_s} s` : null,
    "",
    "Transcript:",
    input.transcript,
    input.notes ? `\nStaff notes:\n${input.notes}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}
