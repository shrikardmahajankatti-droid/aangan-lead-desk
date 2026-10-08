// Deterministic parts of qualification_logic.md, computed in code so they are
// repeatable and testable: project value (Step 2-A), completeness (Step 2-E),
// Gate 4 budget check, the verdict decision rules, total score and label.
// Gemini supplies the judgement calls (gates 1/2/3/5, readiness, commitment, source).

export type GateResult = "pass" | "fail" | "unclear";
export type BudgetResult = "pass" | "pass_tight" | "fail";
export type Gate<R extends string = GateResult> = { result: R; evidence: string };
export type Gates = {
  real_project: Gate;
  service_area: Gate;
  timeline: Gate;
  budget: Gate<BudgetResult>;
  decision_maker: Gate;
};
export type Verdict = "qualified" | "not_qualified" | "nurture" | "needs_info";
export type ScoreLabel = "Hot" | "Warm" | "Standard";

export type ValueInputs = {
  segment: "residential" | "commercial" | null;
  sq_ft: number | null; // stated carpet area
  bhk: number | null;
  scope_extent: "full" | "partial" | "unknown";
  rooms_in_scope: number | null;
  budget_max_lakh: number | null; // only if the caller volunteered a figure
};

// pricing.md / qualification_logic.md constants (₹)
const RES_MIN_PER_SQFT = 1800;
const RES_PREMIUM_PER_SQFT = 3500;
const COM_MIN_PER_SQFT = 1200;
const COM_MID_PER_SQFT = 2800;
const ROOM_MIN_LAKH = 3.5;
const ROOM_MAX_LAKH = 8;
const BHK_DEFAULT_SQFT: Record<number, number> = { 1: 550, 2: 900, 3: 1200, 4: 2000 };
const LAKH = 100_000;

function effectiveArea(v: ValueInputs): number | null {
  if (v.sq_ft && v.sq_ft > 0) return v.sq_ft;
  if (v.bhk && BHK_DEFAULT_SQFT[v.bhk]) return BHK_DEFAULT_SQFT[v.bhk];
  return null;
}

/**
 * Minimum indicative cost in lakh (internal only).
 * Residential: area × ₹1,800 (BHK defaults if no area); partial scope also
 * rooms × ₹3.5 L, and the lower estimate wins. Commercial: area × ₹1,200.
 */
export function minIndicativeLakh(v: ValueInputs): number | null {
  const area = effectiveArea(v);
  if (v.segment === "commercial") return v.sq_ft ? (v.sq_ft * COM_MIN_PER_SQFT) / LAKH : null;
  const byArea = area ? (area * RES_MIN_PER_SQFT) / LAKH : null;
  const byRooms =
    v.scope_extent === "partial" && v.rooms_in_scope ? v.rooms_in_scope * ROOM_MIN_LAKH : null;
  const estimates = [byArea, byRooms].filter((x): x is number => x !== null);
  return estimates.length ? Math.min(...estimates) : null;
}

/** Step 2-A. Partial scope uses rooms × ₹3.5 L (lower of the two); full uses area. */
export function valuePoints(v: ValueInputs): number {
  const lakh = minIndicativeLakh(v);
  if (lakh === null) return 0;
  if (lakh > 30) return 4;
  if (lakh > 15) return 3;
  if (lakh > 8) return 2;
  return 1;
}

/** Step 2-E: location, scope, size and timeline all captured. */
export function completenessPoint(f: {
  location: string | null;
  scope: string | null;
  sq_ft: number | null;
  bhk: number | null;
  timeline: string | null;
}): number {
  return f.location && f.scope && (f.sq_ft || f.bhk) && f.timeline ? 1 : 0;
}

/** Gate 4, only when a figure was volunteered. Compares against the minimum indicative cost. */
export function budgetGate(v: ValueInputs): BudgetResult | null {
  if (v.budget_max_lakh === null) return "pass";
  const min = minIndicativeLakh(v);
  if (min === null) return null; // can't judge in code; keep Gemini's result
  const ratio = v.budget_max_lakh / min;
  if (ratio < 0.6) return "fail";
  if (ratio < 1) return "pass_tight";
  return "pass";
}

/** qualification_logic.md "Decision rules". */
export function decideVerdict(gates: Gates, nurtureEligible: boolean): Verdict {
  const results = [
    gates.real_project.result,
    gates.service_area.result,
    gates.timeline.result,
    gates.budget.result,
    gates.decision_maker.result,
  ];
  const fails = results.filter((r) => r === "fail").length;
  if (fails >= 2) return "not_qualified";
  if (fails === 1) return nurtureEligible ? "nurture" : "not_qualified";
  if ([gates.real_project, gates.service_area, gates.timeline].some((g) => g.result === "unclear"))
    return "needs_info";
  return "qualified"; // Gate 4/5 unclear or tight → still qualified, noted in handoff
}

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 8) return "Hot";
  if (score >= 6) return "Warm";
  return "Standard";
}

/** Designer-only range from pricing.md. Never sent to a caller. */
export function indicativeRange(v: ValueInputs): string | null {
  const area = effectiveArea(v);
  const fmt = (lakh: number) => `₹${lakh >= 100 ? (lakh / 100).toFixed(1) + " Cr" : Math.round(lakh) + " L"}`;
  if (v.segment === "commercial") {
    if (!v.sq_ft) return null;
    return `${fmt((v.sq_ft * COM_MIN_PER_SQFT) / LAKH)}–${fmt((v.sq_ft * COM_MID_PER_SQFT) / LAKH)} (basic to mid-range office, ₹1,200–2,800/sq ft × ${v.sq_ft} sq ft)`;
  }
  if (v.scope_extent === "partial" && v.rooms_in_scope) {
    return `${fmt(v.rooms_in_scope * ROOM_MIN_LAKH)}–${fmt(v.rooms_in_scope * ROOM_MAX_LAKH)} (${v.rooms_in_scope} rooms × ₹3.5–8 L)`;
  }
  if (!area) return null;
  const basis = v.sq_ft ? `${area} sq ft` : `~${area} sq ft assumed for ${v.bhk}BHK`;
  return `${fmt((area * RES_MIN_PER_SQFT) / LAKH)}–${fmt((area * RES_PREMIUM_PER_SQFT) / LAKH)} (standard to premium, ₹1,800–3,500/sq ft × ${basis})`;
}
