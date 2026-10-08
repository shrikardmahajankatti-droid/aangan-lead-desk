import { describe, it, expect } from "vitest";
import { designerEmail, escalationEmail, type EmailCall } from "@/lib/email";

const base: EmailCall = {
  id: "abc",
  started_at: "2026-09-02T10:23:00+05:30",
  after_hours: false,
  caller_number: null,
  score: 9,
  score_label: "Hot",
  urgent: false,
  reasons: ["Gate 1: full redesign", "Source: past-client referral"],
  already_known: "3BHK in Kothrud, 1,400 sq ft, done by March",
  opening_questions: ["q1?", "q2?", "q3?"],
  handoff_notes: [],
  asked_about_price: false,
  indicative_range: "₹25 L–₹49 L",
  summary: "x",
  fields: { caller_name: "Priya", phone: null, property_type: "3BHK apartment", location: "Kothrud", sq_ft: 1400, scope: "Full redesign", budget_band: null, timeline: "by March" },
};
const opts = { designerName: "Asha", baseUrl: "https://aangan-lead-desk.vercel.app" };

describe("designer email", () => {
  it("builds the §8 subject", () => {
    expect(designerEmail(base, null, opts).subject).toBe("🔥 Hot lead: Priya, 3BHK apartment in Kothrud (2 Sept 2026)");
  });
  it("prefixes URGENT and asks for a senior callback", () => {
    const e = designerEmail({ ...base, urgent: true, score: 5, score_label: "Standard" }, null, opts);
    expect(e.subject.startsWith("URGENT – response delayed · Standard lead:")).toBe(true);
    expect(e.text).toContain("Senior designer to call back within 1 hour");
  });
  it("never prints null and drops empty lines/sections", () => {
    const e = designerEmail(
      { ...base, reasons: [], already_known: null, handoff_notes: [], fields: { caller_name: null, location: null, property_type: "3BHK", sq_ft: null, scope: null, budget_band: null, timeline: null } },
      null,
      opts,
    );
    for (const t of [e.subject, e.text, e.html]) expect(t).not.toMatch(/null|undefined/);
    expect(e.text).not.toContain("ALREADY ASKED");
    expect(e.text).not.toContain("Budget:");
    expect(e.text).toContain("WHAT THEY WANT\n3BHK");
    expect(e.text).toContain("Not booked yet – please call to schedule");
  });
  it("shows the pricing guide only if they asked", () => {
    expect(designerEmail(base, null, opts).text).not.toContain("Internal guide");
    expect(designerEmail({ ...base, asked_about_price: true }, null, opts).text).toContain("⚠️ They asked about pricing. No figure was shared. Internal guide: ₹25 L–₹49 L.");
  });
  it("renders the full what-they-want line and a booked slot", () => {
    const e = designerEmail(base, { slot_start: "2026-09-04T11:00:00+05:30" }, opts);
    expect(e.text).toContain("Full redesign for a 1,400 sq ft 3BHK apartment in Kothrud");
    expect(e.text).toMatch(/Booked: 4 Sept, 11:00 am \(calendar invite sent\)/);
    expect(e.html).toContain('<a href="https://aangan-lead-desk.vercel.app/calls/abc">');
  });
});

describe("escalation email", () => {
  it("is short and urgent", () => {
    const e = escalationEmail({ ...base, fields: { caller_name: "Sheetal Deshpande", project: "2BHK, Viman Nagar, designer Aryan", complaint: "No reply in 5 days", phone: null } }, opts);
    expect(e.subject).toBe("URGENT – Escalation: Sheetal Deshpande, 2BHK, Viman Nagar, designer Aryan – call back within 15 min");
    expect(e.text).toContain("COMPLAINT: No reply in 5 days");
    expect(e.text).not.toMatch(/null|undefined/);
  });
});
