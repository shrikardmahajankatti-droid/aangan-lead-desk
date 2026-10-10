import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import type { CallRecord } from "../pipeline";
import type { CallEndedEvent, ToolName, ToolRequest } from "./types";

// THE ONLY VAANI-SPECIFIC FILE.  Platform: Vaani AI (app.vaanivoice.ai, docs.vaanivoice.ai)
//
// Documented and implemented exactly:
//   - Webhooks: POST JSON, `{ event, … }`. Agent webhooks are signed
//       X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>   (observed)
//     campaign webhooks X-Vaani-Signature over "{timestamp}.{body}"     (documented)
//     Events: call_started (has phone_number), call_ended (call_duration in s),
//     call_postprocessing (call_id, transcript, summary, entities, recording_url,
//     call_duration in ms), plus outbound-only ringing/no-answer/rejected/failed.
//   - REST API: https://api.vaanivoice.ai, header X-API-Key: vaani_…
// Dashboard custom tools ("Tools & Actions") send fixed headers only, so tool calls
// carry a shared secret header instead of a per-request signature.
// Not documented: the exact tool-call request body. parseToolRequest() accepts the
// common shapes; adjust it here once a real call has been logged in live_tool_calls.

export const VAANI_API = "https://api.vaanivoice.ai";
export const TOOL_SECRET_HEADER = "x-aangan-tool-secret";
const MAX_SKEW_S = 300;

export class VaaniAuthError extends Error {}

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhooks. Two signing schemes are accepted, both keyed with VAANI_WEBHOOK_SECRET:
 *  - Agent webhooks (observed from the dashboard's Test Connectivity, not in the docs):
 *      X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>, X-Webhook-Event: <event>
 *      (call_started sends the same HMAC without the "sha256=" prefix)
 *    No timestamp header; retries and replays are made harmless by deduping on event + call id.
 *  - Campaign webhooks (documented): X-Vaani-Signature over "{timestamp}.{raw body}" with
 *    X-Vaani-Timestamp, rejected if older than 5 minutes.
 * Returns the raw body.
 */
export async function verifiedWebhookBody(req: Request, now = Date.now()): Promise<string> {
  const raw = await req.text();
  const secret = env("vaani").VAANI_WEBHOOK_SECRET;
  try {
    return checkWebhookSignature(req, raw, secret, now);
  } catch (e) {
    await recordRejection(req, "webhook", (e as Error).message, webhookDiagnostics(req, raw, secret));
    throw e;
  }
}

function checkWebhookSignature(req: Request, raw: string, secret: string, now: number): string {
  const hmac = (data: string) => createHmac("sha256", secret).update(data, "utf8").digest();
  // "sha256=<hex>" on most events; call_started arrives as bare "<hex>" (observed).
  const hexOf = (v: string | null) => v?.trim().match(/^(?:sha256=)?([0-9a-f]{64})$/i)?.[1]?.toLowerCase() ?? null;

  const agentSig = hexOf(req.headers.get("x-webhook-signature"));
  if (agentSig) {
    if (!safeEqual(Buffer.from(agentSig, "hex"), hmac(raw))) throw new VaaniAuthError("bad signature");
    return raw;
  }

  const campaignSig = hexOf(req.headers.get("x-vaani-signature"));
  const ts = req.headers.get("x-vaani-timestamp") ?? "";
  if (!campaignSig || !/^\d+$/.test(ts)) throw new VaaniAuthError("missing signature");
  if (Math.abs(now / 1000 - Number(ts)) > MAX_SKEW_S) throw new VaaniAuthError("stale timestamp");
  if (!safeEqual(Buffer.from(campaignSig, "hex"), hmac(`${ts}.${raw}`))) throw new VaaniAuthError("bad signature");
  return raw;
}

/** Which signing schemes would match a rejected webhook — booleans only, never values. */
function webhookDiagnostics(req: Request, raw: string, secret: string) {
  const sig = (req.headers.get("x-webhook-signature") ?? req.headers.get("x-vaani-signature") ?? "").trim();
  const hex = sig.replace(/^sha256=/i, "").toLowerCase();
  const mac = (d: string) => createHmac("sha256", secret).update(d, "utf8").digest("hex");
  let compact = raw;
  try {
    compact = JSON.stringify(JSON.parse(raw));
  } catch {}
  return {
    sigPrefix: sig.match(/^[a-z0-9]+=/i)?.[0] ?? null,
    sigLen: hex.length,
    bodyLen: raw.length,
    matches: { body: mac(raw) === hex, compact_json: mac(compact) === hex, empty_body: mac("") === hex },
  };
}

/** Records a rejected Vaani request (no secrets, no body). Never throws. */
async function recordRejection(req: Request, route: string, reason: string, details: Record<string, unknown>) {
  try {
    const { sql } = await import("../db");
    await sql()`
      insert into rejected_requests (route, reason, event, header_names, details)
      values (${`${route} ${new URL(req.url).pathname}`}, ${reason}, ${req.headers.get("x-webhook-event")},
        ${[...req.headers.keys()].filter((k) => !k.startsWith("x-vercel") && !k.startsWith("x-forwarded"))}, ${JSON.stringify(details)})`;
  } catch (e) {
    console.error("could not record rejection:", (e as Error).message);
  }
}

/** Mid-call tools: the dashboard sends a fixed header carrying the shared secret (whitespace from pasting is ignored). */
export async function verifiedToolBody(req: Request): Promise<string> {
  const raw = req.headers.get(TOOL_SECRET_HEADER);
  const given = (raw ?? "").trim();
  const secret = env("vaani").VAANI_WEBHOOK_SECRET;
  if (!given || !safeEqual(Buffer.from(given), Buffer.from(secret))) {
    await recordRejection(req, "tool", "bad tool secret", {
      headerPresent: raw !== null,
      givenLen: given.length,
      expectedLen: secret.length,
      hadWhitespace: raw !== null && raw !== given,
    });
    throw new VaaniAuthError("bad tool secret");
  }
  return req.text();
}

/** For tests / the simulator: signs a body the way Vaani's agent webhooks do. */
export function signAgentWebhook(raw: string, secret = env("vaani").VAANI_WEBHOOK_SECRET, event = "call_postprocessing") {
  return { "x-webhook-signature": `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`, "x-webhook-event": event };
}

/** For tests: the documented campaign-webhook signature. */
export function signWebhook(raw: string, secret = env("vaani").VAANI_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) {
  return { "x-vaani-signature": `sha256=${createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex")}`, "x-vaani-timestamp": String(ts) };
}

// ---------------------------------------------------------------------------
// Defensive field access
// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function pick(o: unknown, ...paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split(".")) cur = isObj(cur) ? cur[k] : undefined;
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
const num = (v: unknown) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * "[13:33:14] AGENT: Hi…\n\n[13:33:19] USER: Yeah…" → "Agent: Hi…\nCaller: Yeah…"
 * (also accepts arrays of { role, text }).
 */
export function normaliseTranscript(v: unknown): { text: string | null; userTurns: number } {
  if (Array.isArray(v)) {
    const lines = v
      .filter(isObj)
      .map((t) => {
        const role = String(pick(t, "role", "speaker") ?? "").toLowerCase();
        const text = str(pick(t, "text", "content", "message"));
        return text ? `${/user|caller|customer/.test(role) ? "Caller" : "Agent"}: ${text}` : null;
      })
      .filter((l): l is string => Boolean(l));
    return { text: lines.join("\n") || null, userTurns: lines.filter((l) => l.startsWith("Caller:")).length };
  }
  if (typeof v !== "string" || !v.trim() || /not available/i.test(v)) return { text: null, userTurns: 0 };
  const lines = v
    .split(/\n+/)
    .map((l) => l.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, ""))
    .filter(Boolean)
    .map((l) => l.replace(/^AGENT:\s*/i, "Agent: ").replace(/^USER:\s*/i, "Caller: "));
  return { text: lines.join("\n"), userTurns: lines.filter((l) => l.startsWith("Caller:")).length };
}

export type WebhookEvent =
  | { kind: "started"; delivery_id: string; call_id: string; phone_number: string | null; status: string | null; raw: Obj }
  | { kind: "ended"; delivery_id: string; call_id: string; duration_s: number | null; end_reason: string | null; raw: Obj }
  | { kind: "postprocessed"; delivery_id: string; event: CallEndedEvent }
  | { kind: "ignore"; reason: string };

/** Maps a verified webhook body to our events. Vaani has no event id, so the delivery key is event + call id. */
export function parseWebhook(raw: string, receivedAt = new Date()): WebhookEvent {
  const p = JSON.parse(raw) as Obj;
  const event = str(p.event);
  const d = isObj(p.data) ? p.data : p;
  const callId = str(pick(d, "call_id", "room_name")) ?? str(pick(p, "call_id", "room_name"));
  if (!event || !callId) return { kind: "ignore", reason: `no event/call id (${event ?? "?"})` };
  const delivery_id = `${event}:${callId}`;

  if (event === "call_started")
    return { kind: "started", delivery_id, call_id: callId, phone_number: str(pick(d, "phone_number", "from", "caller_number")), status: str(d.status), raw: p };
  if (event === "call_ended")
    return { kind: "ended", delivery_id, call_id: callId, duration_s: num(d.call_duration), end_reason: str(d.end_reason), raw: p };

  if (event === "call_postprocessing") {
    const t = normaliseTranscript(pick(d, "transcript", "transcription"));
    // Timing: prefer the explicit timestamps "Send all call details" includes. call_duration is
    // documented as ms but observed in seconds (107.42 for a 1m48s call), so only trust it as a
    // fallback and read big values as ms.
    const ts = (v: unknown) => {
      const x = str(v) ? Date.parse(str(v)!) : NaN;
      return Number.isNaN(x) ? null : x;
    };
    const answered = ts(pick(d, "picked_up_at", "call_started_at"));
    const ended = ts(d.call_ended_at);
    const rawDur = num(d.call_duration);
    const duration_s =
      answered !== null && ended !== null && ended >= answered
        ? Math.round((ended - answered) / 1000)
        : rawDur === null ? null : Math.round(rawDur > 10_000 ? rawDur / 1000 : rawDur);
    const doneAt = ts(p.timestamp) ?? receivedAt.getTime();
    const startedAt = new Date(ts(pick(d, "call_started_at", "picked_up_at", "call_dialing_at")) ?? doneAt - (duration_s ?? 0) * 1000);
    // Browser test calls report "web-user" instead of a number.
    const phone = str(pick(d, "phone_number", "from")) ?? str(p.from);
    const callerNumber = phone && /\d{6,}/.test(phone) ? phone : null;
    // Inbound calls are answered by the agent, so "missed" means no conversation at all;
    // a caller who hung up before saying anything useful is a dropped call.
    const status: CallEndedEvent["status"] = !t.text ? "missed" : t.userTurns <= 1 && (duration_s ?? 0) < 25 ? "dropped" : "completed";
    return {
      kind: "postprocessed",
      delivery_id,
      event: {
        event_id: delivery_id,
        event_type: "call.completed",
        vaani_call_id: callId,
        caller_number: callerNumber, // else filled from the call_started event
        started_at: startedAt.toISOString(),
        duration_s,
        answer_delay_s: 0, // the agent answers inbound calls immediately
        status,
        transcript: t.text,
        recording_url: str(d.recording_url),
        escalation: false, // Step 0 (Gemini + header rules) decides
        raw: p,
      },
    };
  }
  if (["call_rejected", "call_no_answer", "call_failed"].includes(event)) {
    // Outbound-only per the docs; we don't place outbound calls, but keep a record if one arrives.
    return {
      kind: "postprocessed",
      delivery_id,
      event: {
        event_id: delivery_id, event_type: "call.failed", vaani_call_id: callId, caller_number: null,
        started_at: receivedAt.toISOString(), duration_s: null, answer_delay_s: null, status: "missed",
        transcript: null, recording_url: null, escalation: false, raw: p,
      },
    };
  }
  return { kind: "ignore", reason: `event ${event}` };
}

export function toCallRecord(e: CallEndedEvent, source: "vaani" | "simulated" = "vaani"): CallRecord {
  return {
    source,
    external_id: e.vaani_call_id,
    caller_number: e.caller_number,
    started_at: e.started_at,
    duration_s: e.duration_s,
    answer_delay_s: e.answer_delay_s,
    status: e.status,
    flags: { escalate: e.escalation },
    transcript: e.transcript,
    notes: null,
    recording_url: e.recording_url,
    raw_payload: e.raw,
  };
}

// ---------------------------------------------------------------------------
// Mid-call tools
// ---------------------------------------------------------------------------
/** Accepts the parameters at the top level or under args/arguments/parameters (object or JSON string). */
export function parseToolRequest(tool: ToolName, raw: string, url?: URL): ToolRequest {
  const body = raw ? (JSON.parse(raw) as Obj) : {};
  let args = pick(body, "args", "arguments", "parameters", "input", "tool_call.arguments") ?? body;
  if (typeof args === "string") args = JSON.parse(args);
  const q = (k: string) => url?.searchParams.get(k) ?? null;
  return {
    tool,
    vaani_call_id: str(pick(body, "call_id", "room_name", "metadata.call_id")) ?? q("call_id"),
    caller_number: str(pick(body, "caller_number", "phone_number", "from")) ?? q("caller_number"),
    args: isObj(args) ? args : {},
  };
}

export function toolResponse(result: Obj): Response {
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
