import "server-only";
import { env, isDryRun } from "./env";
import { db } from "./supabase";

const GROUPS = ["app", "supabase", "gemini", "vaani", "google", "resend", "hubspot"] as const;
const TABLES = ["calls", "leads", "bookings", "events", "webhook_deliveries", "seed_uploads"] as const;

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
    const tables = await Promise.all(
      TABLES.map(async (name) => {
        const { count, error } = await db().from(name).select("*", { count: "exact", head: true });
        if (error) throw new Error(`${name}: ${error.message}`);
        return { name, count: count ?? 0 };
      }),
    );
    dbStatus = { tables };
  } catch (e) {
    dbStatus = { tables: [], error: (e as Error).message };
  }

  let dryRun = true;
  try {
    dryRun = isDryRun();
  } catch {}
  return { env: envStatus, db: dbStatus, dryRun };
}
