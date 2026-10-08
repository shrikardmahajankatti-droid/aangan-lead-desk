// Checks the HubSpot side: token works, aangan_call_id contact property exists
// (creates it if the token has crm.schemas.contacts.write), and the two deal stages exist.
// Usage: npm run hubspot:setup
import { ensureCallIdProperty, resolveStages, STAGE_LABELS } from "../src/lib/hubspot";

try {
  console.log(`contact property aangan_call_id: ${await ensureCallIdProperty()}`);
} catch (e) {
  console.log(`✗ contact property: ${(e as Error).message.slice(0, 200)}`);
}
try {
  const s = await resolveStages();
  console.log(`✓ pipeline ${s.pipeline}: "${STAGE_LABELS.booked}" = ${s.booked}, "${STAGE_LABELS.new}" = ${s.new}`);
} catch (e) {
  console.log(`✗ ${(e as Error).message.slice(0, 300)}`);
}
