import { createHash } from "node:crypto";
import { z } from "zod";
import { processCall } from "@/lib/pipeline";

export const maxDuration = 300;

const Body = z.object({
  external_id: z.string().min(1).optional(),
  transcript: z.string().min(1),
  notes: z.string().nullable().optional(),
  caller_number: z.string().nullable().optional(),
  started_at: z.string().datetime({ offset: true }).nullable().optional(),
  duration_s: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(["completed", "missed", "dropped"]).default("completed"),
  escalate: z.boolean().optional(),
});

/** Runs a single transcript through processCall (source "simulated"; never books). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const b = parsed.data;
  const outcome = await processCall({
    source: "simulated",
    external_id: b.external_id ?? `manual-${createHash("sha256").update(b.transcript).digest("hex").slice(0, 10)}`,
    caller_number: b.caller_number ?? null,
    started_at: b.started_at ?? new Date().toISOString(),
    duration_s: b.duration_s ?? null,
    status: b.status,
    flags: { escalate: b.escalate },
    transcript: b.transcript,
    notes: b.notes ?? null,
  });
  return Response.json(outcome, { status: outcome.outcome === "error" ? 502 : 200 });
}
