import "server-only";
import { env, isDryRun, type EnvGroup } from "./env";
import { sql } from "./db";

const GROUPS: EnvGroup[] = ["app", "db", "gemini", "vaani", "google", "resend", "hubspot"];
const TABLES = [
  "calls",
  "analyses",
  "bookings",
  "actions",
  "overrides",
  "webhook_deliveries",
  "seed_uploads",
] as const;

/** Reports which env groups are configured (never values) and table row counts. */
export async function setupStatus() {
  const envStatus = GROUPS.map((group) => {
    try {
      env(group);
      return { group, ok: true as const };
    } catch (e) {
      return { group, ok: false as const, error: (e as Error).message.replace(/^.*?: /, "missing ") };
    }
  });

  let dbStatus: { tables: { name: string; count: number }[]; error?: string };
  try {
    // Table names come from the constant list above, never from input.
    const counts = await Promise.all(
      TABLES.map(async (name) => {
        const rows = (await sql().query(`select count(*)::int as n from ${name}`)) as { n: number }[];
        return { name, count: rows[0].n };
      }),
    );
    dbStatus = { tables: counts };
  } catch (e) {
    dbStatus = { tables: [], error: (e as Error).message };
  }

  let dryRun = true;
  try {
    dryRun = isDryRun();
  } catch {}
  return { env: envStatus, db: dbStatus, dryRun };
}
