import { z } from "zod";
import { randomUUID } from "node:crypto";
import { acceptCallEnded } from "@/lib/vaani/handlers";
import type { CallEndedEvent } from "@/lib/vaani/types";

export const maxDuration = 300;

const Body = z.object({
  transcript: z.string().nullable().default(null),
  caller_number: z.string().nullable().default("+91 98XXX XX123"),
  status: z.enum(["completed", "missed", "dropped"]).default("completed"),
  started_at: z.string().datetime({ offset: true }).optional(),
  duration_s: z.number().int().nonnegative().nullable().default(180),
  vaani_call_id: z.string().optional(),
  escalation: z.boolean().default(false),
});

/**
 * Dev only: feeds a sample call through the same CallEndedEvent path as the Vaani
 * webhook (dedupe → processCall → route → deliver), synchronously, without a signature.
 * Disabled in production unless ALLOW_SIMULATE=true.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SIMULATE !== "true")
    return Response.json({ error: "not found" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const b = parsed.data;
  const id = b.vaani_call_id ?? `sim-${randomUUID().slice(0, 8)}`;
  const event: CallEndedEvent = {
    event_id: `evt_sim_${randomUUID()}`,
    event_type: b.status === "missed" ? "call.failed" : "call.completed",
    vaani_call_id: id,
    caller_number: b.caller_number,
    started_at: b.started_at ?? new Date().toISOString(),
    duration_s: b.status === "missed" ? null : b.duration_s,
    answer_delay_s: b.status === "missed" ? null : 0,
    status: b.status,
    transcript: b.transcript,
    recording_url: null,
    escalation: b.escalation,
    raw: { simulated: true, ...b },
  };
  const accepted = await acceptCallEnded(event, "simulated");
  const outcome = await accepted.work();
  return Response.json({ vaani_call_id: id, outcome });
}
