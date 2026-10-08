import "server-only";
import { sql } from "../db";
import { env, isDryRun } from "../env";
import { processCall, type ProcessOutcome } from "../pipeline";
import { liveQualify, LiveArgs, LINES } from "../liveQualify";
import { getSlots, bookSlot } from "../calendar";
import { findSlots, type Slot } from "../slots";
import { toCallRecord } from "./adapter";
import type { CallEndedEvent, ToolRequest } from "./types";

async function logTool(r: ToolRequest, response: unknown, started: number, extra: { degraded?: string; usage?: { tokens_in: number; tokens_out: number; cost_inr: number } } = {}) {
  await sql()`
    insert into live_tool_calls (vaani_call_id, tool, request, response, degraded, latency_ms, tokens_in, tokens_out, cost_inr)
    values (${r.vaani_call_id}, ${r.tool}, ${JSON.stringify(r)}, ${JSON.stringify(response)}, ${extra.degraded ?? null},
      ${Date.now() - started}, ${extra.usage?.tokens_in ?? 0}, ${extra.usage?.tokens_out ?? 0}, ${extra.usage?.cost_inr ?? 0})`.catch(
    (e) => console.error("live_tool_calls log failed:", (e as Error).message),
  );
}

export async function handleQualify(r: ToolRequest) {
  const started = Date.now();
  const args = LiveArgs.safeParse(r.args);
  const out = await liveQualify(args.success ? args.data : {}, 2500);
  const response = { ...out.result, say: out.result.reason_for_agent };
  await logTool(r, response, started, { degraded: out.degraded ?? (args.success ? undefined : "bad args"), usage: out.usage });
  return response;
}

/** Calendar is read-only here, so it runs in dry run too; without Google creds in dry run, slots come from an empty calendar. */
export async function handleSlots(r: ToolRequest) {
  const started = Date.now();
  let slots: Slot[] = [];
  let degraded: string | undefined;
  try {
    slots = await getSlots({ timeoutMs: 2500 });
  } catch (e) {
    const noCreds = /Missing or invalid env for google/.test((e as Error).message);
    if (noCreds && isDryRun()) {
      const g = { hours: process.env.CONSULT_HOURS || "10:00-19:00", dur: Number(process.env.CONSULT_DURATION_MIN || 60) };
      const now = new Date();
      slots = findSlots({ now, busy: [], hours: g.hours, durationMin: g.dur });
      degraded = "dry run: no Google credentials, empty calendar assumed";
    } else degraded = (e as Error).message.slice(0, 200);
  }
  const response = slots.length
    ? {
        slots: slots.map((s) => ({ slot_id: s.id, speech: s.speech })),
        say: `I can offer ${slots.map((s) => s.speech).join(", or ")}. Which works best for you?`,
      }
    : { slots: [], booking_pending: true, say: LINES.fallback };
  await logTool(r, response, started, { degraded });
  return response;
}

export async function handleBook(r: ToolRequest) {
  const started = Date.now();
  const a = r.args as Record<string, unknown>;
  const slot = typeof a.slot_id === "string" ? a.slot_id : typeof a.slot_start === "string" ? a.slot_start : null;
  let response: Record<string, unknown>;
  let degraded: string | undefined;
  if (!slot) {
    response = { ok: false, say: "Which of those times would you like?" };
  } else {
    try {
      const res = await bookSlot(
        {
          vaani_call_id: r.vaani_call_id,
          slot_start: slot,
          caller_name: (a.caller_name as string) ?? null,
          caller_phone: (a.caller_phone as string) ?? r.caller_number,
          caller_email: (a.caller_email as string) ?? null,
          location: (a.location as string) ?? null,
        },
        { timeoutMs: 2500 },
      );
      response = res.ok
        ? { ok: true, event_id: res.event_id, confirmation_line: res.confirmation_line, say: res.confirmation_line, dry_run: res.dry_run }
        : { ok: false, reason: res.reason, say: res.confirmation_line };
    } catch (e) {
      degraded = (e as Error).message.slice(0, 200);
      response = { ok: false, booking_pending: true, say: LINES.fallback };
    }
  }
  await logTool(r, response, started, { degraded });
  return response;
}

/** call_started carries the caller's number; keep it for the post-processed event. */
export async function recordCallStart(ev: { call_id: string; phone_number: string | null; status: string | null; raw: unknown }) {
  await sql()`
    insert into vaani_call_starts (call_id, phone_number, status, payload)
    values (${ev.call_id}, ${ev.phone_number}, ${ev.status}, ${JSON.stringify(ev.raw)})
    on conflict (call_id) do update set phone_number = coalesce(excluded.phone_number, vaani_call_starts.phone_number)`;
}

/**
 * Post-call: record the delivery once (Vaani retries up to 5 times), then process.
 * Returns quickly; the caller runs `work` after responding.
 */
export async function acceptCallEnded(e: CallEndedEvent, source: "vaani" | "simulated") {
  const fresh = (await sql()`
    insert into webhook_deliveries (event_id, event_type) values (${e.event_id}, ${e.event_type})
    on conflict (event_id) do nothing returning event_id`) as { event_id: string }[];
  if (!fresh.length) return { duplicate: true as const, work: async () => null };
  return {
    duplicate: false as const,
    work: async (): Promise<ProcessOutcome> => {
      if (!e.caller_number) {
        const [start] = (await sql()`
          select phone_number, received_at from vaani_call_starts where call_id = ${e.vaani_call_id}`) as { phone_number: string | null; received_at: string }[];
        if (start) {
          e.caller_number = start.phone_number;
          e.started_at = new Date(start.received_at).toISOString(); // more accurate than end − duration
        }
      }
      return processCall(toCallRecord(e, source)); // links mid-call bookings before routing
    },
  };
}

export const baseUrl = () => env("app").APP_BASE_URL;
