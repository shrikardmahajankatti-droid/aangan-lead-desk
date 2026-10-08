import { describe, it, expect } from "vitest";
import { valuePoints, budgetGate, decideVerdict, scoreLabel, completenessPoint, type Gates, type ValueInputs } from "@/lib/scoring";

const v = (o: Partial<ValueInputs>): ValueInputs => ({
  segment: "residential", sq_ft: null, bhk: null, scope_extent: "full", rooms_in_scope: null, budget_max_lakh: null, ...o,
});

// Value points (Step 2-A) for the qualified calibration calls, from the facts in each transcript.
describe("value points match the calibration table", () => {
  const cases: [string, ValueInputs, number][] = [
    ["T01 3BHK 1,400 full", v({ sq_ft: 1400, bhk: 3 }), 3],
    ["T02 2BHK 950 full", v({ sq_ft: 950, bhk: 2 }), 3],
    ["T05 4BHK 2,400 full", v({ sq_ft: 2400, bhk: 4 }), 4],
    ["T06 office 800", v({ segment: "commercial", sq_ft: 800 }), 2],
    ["T11 2BHK, 3 rooms", v({ bhk: 2, scope_extent: "partial", rooms_in_scope: 3 }), 2],
    ["T12 villa 5,500", v({ sq_ft: 5500 }), 4],
    ["T13 3BHK 1,100, 4 rooms", v({ sq_ft: 1100, bhk: 3, scope_extent: "partial", rooms_in_scope: 4 }), 2],
    ["T14 3BHK, scope unknown", v({ bhk: 3, scope_extent: "unknown" }), 3],
    ["T15 2BHK 875 full", v({ sq_ft: 875, bhk: 2 }), 3],
    ["T16 3BHK, scope unknown", v({ bhk: 3, scope_extent: "unknown" }), 3],
    ["T17 3BHK 1,050 full", v({ sq_ft: 1050, bhk: 3 }), 3],
    ["T20 2BHK 900 full", v({ sq_ft: 900, bhk: 2 }), 3],
  ];
  it.each(cases)("%s → %i", (_, input, expected) => expect(valuePoints(input)).toBe(expected));
});

describe("Gate 4 budget", () => {
  it("T10: ₹1.5 L for kitchen + bedroom in a 550 sq ft 1BHK fails (min ≈ ₹7 L)", () =>
    expect(budgetGate(v({ sq_ft: 550, bhk: 1, scope_extent: "partial", rooms_in_scope: 2, budget_max_lakh: 1.5 }))).toBe("fail"));
  it("no budget mentioned passes", () => expect(budgetGate(v({ sq_ft: 900 }))).toBe("pass"));
  it("60–100% of minimum is pass_tight", () => expect(budgetGate(v({ sq_ft: 1000, budget_max_lakh: 12 }))).toBe("pass_tight"));
});

const g = (r: Partial<Record<keyof Gates, string>>): Gates =>
  Object.fromEntries(
    (["real_project", "service_area", "timeline", "budget", "decision_maker"] as const).map((k) => [k, { result: r[k] ?? "pass", evidence: "x" }]),
  ) as Gates;

describe("decision rules", () => {
  it("all pass → qualified", () => expect(decideVerdict(g({}), false)).toBe("qualified"));
  it("Gate 5 unclear → qualified (noted)", () => expect(decideVerdict(g({ decision_maker: "unclear" }), false)).toBe("qualified"));
  it("Gate 1 unclear → needs_info", () => expect(decideVerdict(g({ real_project: "unclear" }), false)).toBe("needs_info"));
  it("one fail → not_qualified", () => expect(decideVerdict(g({ service_area: "fail" }), false)).toBe("not_qualified"));
  it("one timing fail, nurture-eligible → nurture", () => expect(decideVerdict(g({ timeline: "fail" }), true)).toBe("nurture"));
  it("two fails → not_qualified even if nurture-eligible", () =>
    expect(decideVerdict(g({ timeline: "fail", real_project: "fail" }), true)).toBe("not_qualified"));
});

describe("labels and completeness", () => {
  it.each([[10, "Hot"], [8, "Hot"], [7, "Warm"], [6, "Warm"], [5, "Standard"], [0, "Standard"]])("%i → %s", (s, l) =>
    expect(scoreLabel(s as number)).toBe(l));
  it("T13 has no timeline → 0", () =>
    expect(completenessPoint({ location: "Aundh", scope: "kitchen", sq_ft: 1100, bhk: 3, timeline: null })).toBe(0));
});
