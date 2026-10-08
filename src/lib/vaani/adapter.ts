import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import type { CallRecord } from "../pipeline";
import type { CallEndedEvent, ToolName, ToolRequest } from "./types";

// THE ONLY VAANI-SPECIFIC FILE.
//
// Documented (vaanilabs.in/openapi/v1/vaanivoice.yaml):
//   - X-VaaniVoice-Signature: "sha256=" + lowercase hex HMAC-SHA256(raw body, webhook secret)
//   - Envelope { id: "evt_…", type, created, data }; id is reused across retries
//   - Events: call.completed, call.failed, webhook.ping; phone numbers masked; "no sub-field is guaranteed"
// NOT documented (mapped defensively below; adjust here once Vaani shares the real shapes):
//   - the call.completed `data` fields (transcript, recording, timing, status, caller)
//   - the mid-call tool-call request/response format and whether tool calls are signed the same way

export class VaaniAuthError extends Error {}

/** Verifies the HMAC signature over the exact raw body. Returns the raw text. */
export async function verifiedBody(req: Request): Promise<string> {
  const raw = await req.text();
  const secret = env("vaani").VAANI_WEBHOOK_SECRET;
  const header = req.headers.get("x-vaanivoice-signature") ?? "";
  const m = header.match(/^sha256=([0-9a-f]{64})$/);
  if (!m) throw new VaaniAuthError("missing or malformed X-VaaniVoice-Signature");
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
  const given = Buffer.from(m[1], "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new VaaniAuthError("bad signature");
  return raw;
}

/** For tests / the simulator: signs a body the way Vaani does. */
export function sign(raw: string, secret = env("vaani").VAANI_WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
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
function iso(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Transcript may arrive as a string or as [{ role, text|content|message }]. */
function transcriptText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!Array.isArray(v)) return null;
  const lines = v
    .map((t) => {
      if (!isObj(t)) return null;
      const role = String(pick(t, "role", "speaker", "from") ?? "").toLowerCase();
      const text = str(pick(t, "text", "content", "message", "transcript"));
      if (!text) return null;
      const who = /user|caller|customer|human/.test(role) ? "Caller" : /agent|assistant|bot|ai/.test(role) ? "Agent" : role || "Speaker";
      return `${who}: ${text}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Post-call webhook → CallEndedEvent → CallRecord
// ---------------------------------------------------------------------------
export function parseCallEnded(raw: string): CallEndedEvent | { ignore: string; event_id: string | null; type: string | null } {
  const env_ = JSON.parse(raw) as Obj;
  const type = str(env_.type);
  const eventId = str(env_.id);
  if (type !== "call.completed" && type !== "call.failed") return { ignore: `event type ${type}`, event_id: eventId, type };
  const d = isObj(env_.data) ? env_.data : {};

  const callId = str(pick(d, "call_id", "id", "call.id", "session_id", "usage_id")) ?? eventId!;
  const rawStatus = String(pick(d, "status", "call_status", "end_reason", "disposition") ?? (type === "call.failed" ? "failed" : "completed")).toLowerCase();
  const duration = num(pick(d, "duration_s", "duration_seconds", "duration", "billed_seconds"));
  const transcript = transcriptText(pick(d, "transcript", "transcript_text", "messages", "conversation"));

  let status: CallEndedEvent["status"];
  if (/miss|no[-_ ]?answer|unanswered|not[-_ ]?answered|busy/.test(rawStatus) || (type === "call.failed" && !transcript)) status = "missed";
  else if (/drop|disconnect|abandon|hang|fail/.test(rawStatus)) status = "dropped";
  else status = "completed";

  return {
    event_id: eventId!,
    event_type: type,
    vaani_call_id: callId,
    caller_number: str(pick(d, "caller_number", "from", "from_number", "caller.phone", "customer.number", "phone")),
    started_at: iso(pick(d, "started_at", "start_time", "startedAt", "created_at")) ?? iso(env_.created),
    duration_s: duration === null ? null : Math.round(duration),
    answer_delay_s: num(pick(d, "ring_duration_s", "answer_delay_s", "ring_seconds")),
    status,
    transcript,
    recording_url: str(pick(d, "recording_url", "recording.url", "recordingUrl", "audio_url")),
    escalation: Boolean(pick(d, "escalation", "variables.escalation", "metadata.escalation")),
    raw: env_,
  };
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
/** Accepts {args|arguments|parameters|input} plus call metadata in common shapes. */
export function parseToolRequest(tool: ToolName, raw: string): ToolRequest {
  const body = raw ? (JSON.parse(raw) as Obj) : {};
  let args = pick(body, "args", "arguments", "parameters", "input", "tool_call.arguments", "function.arguments") ?? body;
  if (typeof args === "string") args = JSON.parse(args);
  return {
    tool,
    vaani_call_id: str(pick(body, "call_id", "call.id", "session_id", "metadata.call_id")),
    caller_number: str(pick(body, "caller_number", "from", "call.from", "metadata.caller_number")),
    args: isObj(args) ? args : {},
  };
}

/** Our tool result → what Vaani expects back. Unknown until documented: plain JSON with a `say` line. */
export function toolResponse(result: Obj): Response {
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
