// Designer handoff and escalation emails (brief §8). Pure: builds subject, text
// and HTML from a call; any part whose field is null is left out, never "null".
import { fmtDate, fmtDateTime, fmtTime } from "./format";

export type EmailCall = {
  id: string;
  started_at: string | null;
  after_hours: boolean | null;
  caller_number: string | null;
  score: number | null;
  score_label: string | null;
  urgent: boolean;
  reasons: string[] | null;
  already_known: string | null;
  opening_questions: string[] | null;
  handoff_notes: string[] | null;
  asked_about_price: boolean | null;
  indicative_range: string | null;
  summary: string | null;
  transcript?: string | null;
  fields: Record<string, unknown> | null;
};
export type EmailBooking = { slot_start: string } | null;
export type Email = { subject: string; text: string; html: string };

const has = (v: unknown): v is string | number => v !== null && v !== undefined && String(v).trim() !== "";
const s = (v: unknown) => (has(v) ? String(v).trim() : null);
const join = (parts: (string | null | undefined)[], sep: string) => parts.filter((p) => has(p)).join(sep);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CALLBACK: Record<string, string> = { Hot: "Call back within 1 hour", Warm: "Call back today", Standard: "Call back within 24 hours" };

export function designerEmail(c: EmailCall, booking: EmailBooking, o: { designerName?: string | null; baseUrl: string }): Email {
  const f = c.fields ?? {};
  const name = s(f.caller_name);
  const phone = s(f.phone) ?? s(c.caller_number);
  const property = s(f.property_type);
  const location = s(f.location);
  const date = fmtDate(c.started_at);
  const label = c.score_label ?? "Standard";

  const subject =
    (c.urgent ? "URGENT – response delayed · " : "") +
    `${label === "Hot" ? "🔥 Hot" : label} lead: ` +
    (join([name, join([property, location && `in ${location}`], " ")], ", ") || "new enquiry") +
    (date ? ` (${date})` : "");

  const callback = c.urgent ? "Senior designer to call back within 1 hour" : CALLBACK[label];
  // "{scope} for a {sq_ft} sq ft {property_type} in {location}", leaving out missing parts.
  const sqft = has(f.sq_ft) ? `${Number(f.sq_ft).toLocaleString("en-IN")} sq ft` : null;
  const thing = join([sqft, property], " ");
  const scope = s(f.scope);
  const wantLine = scope
    ? join([scope, thing && `for a ${thing}`, location && `in ${location}`], " ")
    : join([thing && thing[0].toUpperCase() + thing.slice(1), location && `in ${location}`], " ");
  const budgetLine = join([s(f.budget_band) && `Budget: ${s(f.budget_band)}`, s(f.timeline) && `Timeline: ${s(f.timeline)}`], " · ");
  const notes = (c.handoff_notes ?? []).filter(has);
  const questions = (c.opening_questions ?? []).filter(has);
  const link = `${o.baseUrl.replace(/\/$/, "")}/calls/${c.id}`;

  // Sections as [heading | null, lines[]]; empty sections are dropped.
  const sections: [string | null, string[]][] = [
    [null, [`Hi ${s(o.designerName) ?? ""}`.trim() + ",", "", "A qualified enquiry came in. Here's everything you need."]],
    [
      "WHO CALLED",
      [
        join([name, phone], " · ") || "Name and number not captured",
        c.started_at
          ? `Called on ${date} at ${fmtTime(c.started_at)}` + (c.after_hours === null ? "" : ` (${c.after_hours ? "after hours" : "business hours"})`)
          : "",
      ].filter(has),
    ],
    ["CONSULTATION", [booking ? `Booked: ${fmtDateTime(booking.slot_start)} (calendar invite sent)` : "Not booked yet – please call to schedule"]],
    [
      `LEAD SCORE: ${c.score ?? "–"}/10 (${label}) · ${callback}`,
      (c.reasons ?? []).filter(has).length ? [`Why: ${(c.reasons ?? []).filter(has).join(" · ")}`] : [],
    ],
    ["WHAT THEY WANT", [wantLine, budgetLine].filter(has)],
    ["ALREADY ASKED (don't repeat)", [s(c.already_known)].filter(has) as string[]],
    ["NOTE", notes],
    ["OPEN THE CONVERSATION WITH", questions.map((q, i) => `${i + 1}. ${q}`)],
  ];
  if (c.asked_about_price) {
    sections.push([
      null,
      [
        `⚠️ They asked about pricing. No figure was shared.` +
          (s(c.indicative_range) ? ` Internal guide: ${s(c.indicative_range)}.` : "") +
          ` Confirm after the site visit.`,
      ],
    ]);
  }
  sections.push([null, [`Transcript + recording: ${link}`, "", "Aangan Lead Desk"]]);

  const kept = sections.filter(([h, lines]) => lines.length > 0 || (h !== null && h.startsWith("LEAD SCORE")));
  const text = kept.map(([h, lines]) => [h, ...lines].filter((l) => l !== null).join("\n")).join("\n\n");
  const html = wrapHtml(
    kept
      .map(([h, lines]) => {
        const body = lines
          .map((l) => (l === "" ? "<br>" : esc(l)).replace(esc(link), `<a href="${esc(link)}">${esc(link)}</a>`))
          .join("<br>");
        return `${h ? `<p style="margin:16px 0 4px;font-weight:600;font-size:12px;letter-spacing:.04em;color:#57534e">${esc(h)}</p>` : ""}<p style="margin:0 0 8px">${body}</p>`;
      })
      .join(""),
  );
  return { subject, text, html };
}

export function escalationEmail(c: EmailCall, o: { baseUrl: string }): Email {
  const f = c.fields ?? {};
  const name = s(f.caller_name);
  const phone = s(f.phone) ?? s(c.caller_number);
  const link = `${o.baseUrl.replace(/\/$/, "")}/calls/${c.id}`;
  const subject = `URGENT – Escalation: ${name ?? "existing client"}${s(f.project) ? `, ${s(f.project)}` : ""} – call back within 15 min`;
  const lines = [
    "An existing client called with a complaint. The agent promised a call back from a senior person within 15 minutes.",
    "",
    `WHO: ${join([name, phone], " · ") || "Name and number not captured"}`,
    c.started_at ? `CALLED: ${fmtDate(c.started_at)} at ${fmtTime(c.started_at)}` : "",
    s(f.project) ? `PROJECT: ${s(f.project)}` : "",
    `COMPLAINT: ${s(f.complaint) ?? s(c.summary) ?? "See transcript"}`,
    s(f.callback_request) ? `THEY ASKED FOR: ${s(f.callback_request)}` : "",
    "",
    `Transcript + recording: ${link}`,
    "",
    "Aangan Lead Desk",
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0));
  const text = lines.join("\n");
  const html = wrapHtml(
    `<p style="margin:0 0 8px">${lines
      .map((l) => (l === "" ? "<br>" : esc(l)).replace(esc(link), `<a href="${esc(link)}">${esc(link)}</a>`))
      .join("<br>")}</p>`,
  );
  return { subject, text, html };
}

function wrapHtml(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fafaf9"><div style="max-width:600px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e7e5e4;border-radius:8px;font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917">${inner}</div></body></html>`;
}
