import "server-only";
import { sql } from "./db";
import { env, isDryRun } from "./env";
import { runOnce, type OnceResult } from "./actions";
import { designerEmail, escalationEmail, type EmailCall } from "./email";
import { sendEmail } from "./resend";
import { hubspotPayload, upsertContact, createDealWithNote } from "./hubspot";

type Status = "done" | "dry_run" | "failed";
export type DeliverReport = { email?: { status: Status; detail?: string }; hubspot?: { status: Status; detail?: string } };

// "To do" = pending, failed, or dry_run (re-logged while DRY_RUN is on, really sent once it's off).
// "done" is never redone.
const todo = (status: string, _dry: boolean) => status === "pending" || status === "failed" || status === "dry_run";

function toStatus(r: OnceResult<unknown>): { status: Status; detail?: string } {
  if (r.status === "success") return { status: "done" };
  if (r.status === "dry_run") return { status: "dry_run" };
  if (r.status === "skipped") return { status: "done", detail: r.reason }; // already sent: never repeat
  return { status: "failed", detail: r.error };
}

function opt<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Sends what routeCall marked as needed: designer email + HubSpot for qualified
 * leads, the urgent email for escalations. Each is guarded by runOnce, so calling
 * this again (retry button, re-run, override) never emails or pushes twice.
 */
export async function deliver(callId: string, only?: "email" | "hubspot"): Promise<DeliverReport> {
  const [c] = (await sql()`select * from call_overview where id = ${callId}`) as (EmailCall & {
    record_type: string | null;
    verdict: string | null;
    email_status: string;
    hubspot_status: string;
  })[];
  if (!c) throw new Error("call not found");
  const dry = isDryRun();
  const baseUrl = env("app").APP_BASE_URL;
  const resendEnv = opt(() => env("resend"));
  const report: DeliverReport = {};

  // Escalations: urgent email to Nikhil. Never HubSpot, never the designer.
  if (c.record_type === "escalation") {
    if (only !== "hubspot" && todo(c.email_status, dry)) {
      const email = escalationEmail(c, { baseUrl });
      const to = resendEnv?.ESCALATION_EMAIL ?? process.env.ESCALATION_EMAIL ?? "(ESCALATION_EMAIL not set)";
      const r = await runOnce({ callId, type: "escalation", key: `escalation:${callId}`, dryRun: dry, payload: { to, ...email } }, async (k) => ({
        external_id: await sendEmail(to, email, k),
        result: null,
      }));
      report.email = toStatus(r);
      await sql()`update calls set email_status = ${report.email.status} where id = ${callId}`;
    }
    return report;
  }

  if (c.record_type !== "lead" || c.verdict !== "qualified") return report;

  const [booking] = (await sql()`
    select slot_start from bookings where call_id = ${callId} and status = 'booked' order by created_at desc limit 1`) as { slot_start: string }[];

  if (only !== "hubspot" && todo(c.email_status, dry)) {
    const email = designerEmail(c, booking ?? null, { designerName: resendEnv?.DESIGNER_NAME ?? process.env.DESIGNER_NAME, baseUrl });
    const to = resendEnv?.DESIGNER_EMAIL ?? process.env.DESIGNER_EMAIL ?? "(DESIGNER_EMAIL not set)";
    const r = await runOnce({ callId, type: "email", key: `email:designer:${callId}`, dryRun: dry, payload: { to, ...email } }, async (k) => {
      const id = await sendEmail(to, email, k);
      return { external_id: id, result: null };
    });
    report.email = toStatus(r);
    await sql()`update calls set email_status = ${report.email.status} where id = ${callId}`;
  }

  if (only !== "email" && todo(c.hubspot_status, dry)) {
    const payload = hubspotPayload(c as never, Boolean(booking), baseUrl);
    const r = await runOnce({ callId, type: "hubspot", key: `hubspot:${callId}`, dryRun: dry, payload }, async () => {
      const contactId = await upsertContact(payload.contact);
      await sql()`update calls set hubspot_contact_id = ${contactId} where id = ${callId}`;
      const dealId = await createDealWithNote(payload, contactId);
      await sql()`update calls set hubspot_deal_id = ${dealId} where id = ${callId}`;
      return { external_id: dealId, result: null };
    });
    report.hubspot = toStatus(r);
    await sql()`update calls set hubspot_status = ${report.hubspot.status} where id = ${callId}`;
  }
  return report;
}
