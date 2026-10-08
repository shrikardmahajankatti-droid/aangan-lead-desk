import "server-only";
import { sql } from "./db";

/**
 * Step 5 of processCall: decides what each record needs and sets the separate
 * statuses. Sending (Resend / HubSpot) is done by deliver(), added in step 4;
 * until then qualified calls and escalations wait as 'pending'.
 *
 *   qualified            → designer email + HubSpot
 *   escalation           → urgent email to ESCALATION_EMAIL (never HubSpot, never designer)
 *   missed / dropped     → call-back list (set earlier in the pipeline)
 *   needs_info           → call-back list
 *   not_qualified/nurture→ dashboard only, reason visible
 */
export async function routeCall(callId: string): Promise<string | null> {
  const [c] = (await sql()`
    select id, source, record_type, verdict, booking_status, email_status, hubspot_status
    from call_overview where id = ${callId}`) as {
    id: string;
    source: string;
    record_type: string | null;
    verdict: string | null;
    booking_status: string;
    email_status: string;
    hubspot_status: string;
  }[];
  if (!c) throw new Error(`call ${callId} not found`);

  // 'done' is final for every status: routing never resets a completed action.
  const keepDone = (current: string, next: string) => (current === "done" ? "done" : next);

  if (c.record_type === "escalation") {
    await sql()`
      update calls set email_status = ${keepDone(c.email_status, "pending")}, hubspot_status = 'not_applicable'
      where id = ${callId}`;
    return null;
  }

  if (c.record_type !== "lead") return c.verdict;

  if (c.verdict === "qualified") {
    const [booking] = (await sql()`
      select status from bookings where call_id = ${callId} and status in ('booked', 'dry_run')
      order by created_at desc limit 1`) as { status: string }[];
    // Seed records never book. A live qualified call without a booking is flagged for the designer.
    const bookingStatus =
      c.source === "seed" ? "not_applicable" : booking ? (booking.status === "booked" ? "done" : "dry_run") : "pending";
    await sql()`
      update calls set
        email_status = ${keepDone(c.email_status, "pending")},
        hubspot_status = ${keepDone(c.hubspot_status, "pending")},
        booking_status = ${keepDone(c.booking_status, bookingStatus)}
      where id = ${callId}`;
  } else {
    // Not qualified (or overridden away): nothing to send. Completed sends stay recorded as done.
    await sql()`
      update calls set
        email_status = ${keepDone(c.email_status, "not_applicable")},
        hubspot_status = ${keepDone(c.hubspot_status, "not_applicable")},
        callback_status = case when ${c.verdict} = 'needs_info' then coalesce(callback_status, 'pending') else callback_status end
      where id = ${callId}`;
  }
  return c.verdict;
}
