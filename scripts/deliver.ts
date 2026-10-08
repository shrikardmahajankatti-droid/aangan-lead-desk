// Runs deliver() for every call with pending/failed email or HubSpot (or one call by id).
// Respects DRY_RUN. Usage: npm run deliver [-- <call-id>]
import { sql } from "../src/lib/db";
import { deliver } from "../src/lib/deliver";

const id = process.argv[2];
const rows = (await (id
  ? sql()`select id, external_id from calls where id = ${id}`
  : sql()`select id, external_id from calls
          where email_status in ('pending','failed','dry_run') or hubspot_status in ('pending','failed','dry_run')
          order by external_id`)) as { id: string; external_id: string }[];
console.log(`DRY_RUN=${process.env.DRY_RUN ?? "(default true)"} · ${rows.length} call(s)`);
for (const r of rows) console.log(r.external_id, JSON.stringify(await deliver(r.id)));
