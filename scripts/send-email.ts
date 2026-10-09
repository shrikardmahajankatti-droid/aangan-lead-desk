// Sends (or retries) the handoff email for ONE call via deliver(), exactly like the dashboard's
// "Resend email" button. Respects DRY_RUN; never re-sends a delivered email.
// Usage: DRY_RUN=false npm run send-email -- T05      (seed id or call uuid)
import { sql } from "../src/lib/db";
import { deliver } from "../src/lib/deliver";

const ref = process.argv[2];
if (!ref) throw new Error("Pass a seed id (T05) or call id");
const [c] = (await sql()`
  select id, external_id, verdict, email_status from call_overview
  where id::text = ${ref} or (source = 'seed' and external_id = ${ref}) limit 1`) as { id: string; external_id: string; verdict: string; email_status: string }[];
if (!c) throw new Error(`No call ${ref}`);
console.log(`${c.external_id}: verdict ${c.verdict}, email ${c.email_status} → sending (DRY_RUN=${process.env.DRY_RUN ?? "true"})`);
console.log(JSON.stringify(await deliver(c.id, "email")));
