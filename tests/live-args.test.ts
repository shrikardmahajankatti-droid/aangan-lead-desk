import { it, expect } from "vitest";
import { LiveArgs } from "@/lib/liveQualify";

it("coerces string tool parameters safely", () => {
  const a = LiveArgs.parse({
    sq_ft: "1,200 sq ft", bhk: "3", volunteered_budget_lakh: "1.5", is_existing_client_complaint: "false",
    scope_extent: "Partial", segment: "", rooms_in_scope: "unknown", location: "Baner",
  });
  expect(a).toMatchObject({ sq_ft: 1200, bhk: 3, volunteered_budget_lakh: 1.5, is_existing_client_complaint: false, scope_extent: "partial", segment: null, rooms_in_scope: null, location: "Baner" });
  expect(LiveArgs.parse({ is_existing_client_complaint: "true" }).is_existing_client_complaint).toBe(true);
  expect(LiveArgs.parse({ is_existing_client_complaint: true, sq_ft: 900 })).toMatchObject({ is_existing_client_complaint: true, sq_ft: 900 });
  expect(LiveArgs.parse({})).toEqual({});
});
