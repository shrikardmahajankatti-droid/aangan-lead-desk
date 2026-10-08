import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { splitEnquiries, type SplitResult } from "@/lib/pdfSplit";

let r: SplitResult;
const byId = (id: string) => r.enquiries.find((e) => e.id === id)!;

beforeAll(async () => {
  const parser = new PDFParse({ data: readFileSync("data/Aangan_Sep 2026_Enquiries.pdf") });
  const { text } = await parser.getText();
  await parser.destroy();
  r = splitEnquiries(text);
});

describe("seed PDF split", () => {
  it("finds 40 enquiries: 20 phone, 10 WhatsApp, 10 web form", () => {
    expect(r.counts).toEqual({ total: 40, phone: 20, whatsapp: 10, web_form: 10 });
    expect(r.enquiries.filter((e) => e.channel === "phone").map((e) => e.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("takes the year from the title", () => expect(r.year).toBe(2026));

  it("parses T01 header fields", () => {
    const t = byId("T01");
    expect(t.started_at).toBe("2026-09-02T10:23:00+05:30");
    expect(t.duration_s).toBe(252);
    expect(t.status).toBe("completed");
    expect(t.after_hours).toBe(false);
    expect(t.transcript.split("\n")[0]).toBe("Front Desk: Good morning, Aangan Studio.");
    // wrapped line re-joined
    expect(t.transcript).toContain("She had her flat done by you in Aundh.");
  });

  it("flags T08 as a missed call after hours", () => {
    const t = byId("T08");
    expect(t.flags.missed).toBe(true);
    expect(t.status).toBe("missed");
    expect(t.duration_s).toBeNull();
    expect(t.after_hours).toBe(true);
  });

  it("flags T09 escalation and keeps its Note", () => {
    const t = byId("T09");
    expect(t.flags.escalate).toBe(true);
    expect(t.duration_s).toBe(352);
    expect(t.notes).toBe("Note: Existing project complaint. Escalated to studio head immediately.");
    expect(t.transcript).not.toContain("Note:");
  });

  it("keeps a wrapped Note with T16", () => {
    expect(byId("T16").notes).toMatch(/Caller frustrated\. Handle with care\.$/);
  });

  it("merges T17's two legs into one enquiry", () => {
    const t = byId("T17");
    expect(t.flags.merged).toBe(true);
    expect(t.legs).toEqual([
      { started_at: "2026-09-22T14:14:00+05:30", duration_s: 72, status: "dropped" },
      { started_at: "2026-09-22T14:16:00+05:30", duration_s: 270, status: "completed" },
    ]);
    expect(t.duration_s).toBe(342);
    expect(t.transcript).toContain("Ritu Kapoor");
  });

  it("does not leak section intro text into the last enquiry of a section", () => {
    expect(byId("T20").transcript).not.toMatch(/SECTION|WhatsApp Business/);
    expect(byId("W10").notes).toMatch(/Re-engage in 4–6 weeks\.$/);
    expect(byId("W10").transcript).not.toMatch(/web form|SECTION/i);
  });

  it("marks T20 (9:15am) as after hours", () => expect(byId("T20").after_hours).toBe(true));
});
