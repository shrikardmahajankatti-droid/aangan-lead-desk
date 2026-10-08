// Runs the seed PDF through the same pipeline as the upload page.
// Usage: npm run seed                 (preview + process all 20 phone calls)
//        npm run seed -- --preview    (counts only)
//        npm run seed -- --only=T01,T03
import { readFileSync } from "node:fs";
import { previewSeed, processSeed } from "../src/lib/seed";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const data = new Uint8Array(readFileSync("data/Aangan_Sep 2026_Enquiries.pdf"));

const p = await previewSeed(data);
const c = p.counts;
console.log(`Found ${c.total}: ${c.phone} phone, ${c.whatsapp} WhatsApp, ${c.web_form} web form. Year ${p.year}.`);
if (args.includes("--preview")) process.exit(0);

console.log(`Processing ${only ? only.join(", ") : `${c.phone} phone calls`}…`);
const t0 = Date.now();
// One at a time: the free-tier key allows 5 requests/min per model.
const { results } = await processSeed(data, { only, concurrency: 1 });
console.table(results.map((r) => ({ id: r.external_id, outcome: r.outcome, type: r.record_type, verdict: r.verdict ?? "", error: r.error?.slice(0, 80) ?? "" })));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
