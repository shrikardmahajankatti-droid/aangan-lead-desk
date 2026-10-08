import "server-only";
import { sql } from "./db";

export type ActionType = "email" | "escalation" | "hubspot" | "calendar";
export type OnceResult<T> =
  | { status: "success"; external_id: string | null; result: T }
  | { status: "dry_run" }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

/**
 * Runs an outbound action at most once per idempotency key, and logs it to `actions`.
 *
 * Live: claims the key with an 'in_progress' row. The partial unique index on
 * (idempotency_key) where status in ('in_progress','success') makes a second
 * claim fail, so a concurrent or repeated call is skipped. Success keeps the
 * key forever; an error releases it so the dashboard can retry.
 *
 * Dry run: records the payload that would have been sent (once per key) and calls nothing.
 */
export async function runOnce<T>(
  a: { callId: string | null; type: ActionType; key: string; dryRun: boolean; payload: unknown },
  fn: (attemptKey: string) => Promise<{ external_id: string | null; result: T }>,
): Promise<OnceResult<T>> {
  const payload = JSON.stringify(a.payload);

  if (a.dryRun) {
    // One dry-run row per key, refreshed with the latest payload (keeps the tiles honest).
    const updated = (await sql()`
      update actions set payload = ${payload}, created_at = now()
      where idempotency_key = ${a.key} and status = 'dry_run' returning id`) as { id: number }[];
    if (!updated.length)
      await sql()`
        insert into actions (call_id, type, status, idempotency_key, payload)
        values (${a.callId}, ${a.type}, 'dry_run', ${a.key}, ${payload})`;
    return { status: "dry_run" };
  }

  const claimed = (await sql()`
    insert into actions (call_id, type, status, idempotency_key, payload)
    values (${a.callId}, ${a.type}, 'in_progress', ${a.key}, ${payload})
    on conflict (idempotency_key) where idempotency_key is not null and status in ('in_progress', 'success') do nothing
    returning id`) as { id: number }[];
  if (!claimed.length) {
    const [prev] = (await sql()`
      select status from actions where idempotency_key = ${a.key} and status in ('in_progress', 'success') limit 1`) as { status: string }[];
    return { status: "skipped", reason: prev?.status === "success" ? "already done" : "already in progress" };
  }
  const actionId = claimed[0].id;

  try {
    // attemptKey is unique per attempt: safe to pass to a provider's own idempotency
    // (so a retry after a failure isn't answered from the provider's cache).
    const out = await fn(`${a.key}:${actionId}`);
    await sql()`update actions set status = 'success', external_id = ${out.external_id} where id = ${actionId}`;
    return { status: "success", ...out };
  } catch (e) {
    const error = (e as Error).message.slice(0, 2000);
    await sql()`update actions set status = 'error', error = ${error} where id = ${actionId}`;
    return { status: "error", error };
  }
}
