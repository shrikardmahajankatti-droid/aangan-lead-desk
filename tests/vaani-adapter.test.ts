import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.VAANI_WEBHOOK_SECRET = "whsec_test";
});

const { verifiedWebhookBody, verifiedToolBody, signWebhook, signAgentWebhook, parseWebhook, parseToolRequest, normaliseTranscript, VaaniAuthError } =
  await import("@/lib/vaani/adapter");

const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://x/api/vaani/call-ended", { method: "POST", body, headers });

describe("agent webhook signature (X-Webhook-Signature over the raw body)", () => {
  const raw = '{"event":"webhook_test","timestamp":"2026-10-09T00:11:18Z"}';
  it("accepts the dashboard's signature and rejects tampering or the wrong secret", async () => {
    expect(await verifiedWebhookBody(req(raw, signAgentWebhook(raw, "whsec_test", "webhook_test")))).toBe(raw);
    await expect(verifiedWebhookBody(req(raw + " ", signAgentWebhook(raw, "whsec_test")))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedWebhookBody(req(raw, signAgentWebhook(raw, "other")))).rejects.toBeInstanceOf(VaaniAuthError);
  });
  it("the test event is acknowledged and ignored", () => {
    expect(parseWebhook(raw).kind).toBe("ignore");
  });
});

describe("campaign webhook signature (X-Vaani-Signature over '{timestamp}.{body}')", () => {
  const raw = '{"event":"call_ended","room_name":"r1","call_duration":42.5}';
  it("accepts a valid, fresh signature", async () => {
    expect(await verifiedWebhookBody(req(raw, signWebhook(raw, "whsec_test")))).toBe(raw);
  });
  it("rejects missing, wrong-secret, tampered and stale requests", async () => {
    await expect(verifiedWebhookBody(req(raw))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedWebhookBody(req(raw, signWebhook(raw, "other")))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedWebhookBody(req(raw + " ", signWebhook(raw, "whsec_test")))).rejects.toBeInstanceOf(VaaniAuthError);
    const old = signWebhook(raw, "whsec_test", Math.floor(Date.now() / 1000) - 600);
    await expect(verifiedWebhookBody(req(raw, old))).rejects.toBeInstanceOf(VaaniAuthError);
  });
});

describe("tool secret header", () => {
  it("accepts the shared secret and rejects anything else", async () => {
    await expect(verifiedToolBody(req("{}", { "x-aangan-tool-secret": "whsec_test" }))).resolves.toBe("{}");
    await expect(verifiedToolBody(req("{}", { "x-aangan-tool-secret": "nope" }))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedToolBody(req("{}"))).rejects.toBeInstanceOf(VaaniAuthError);
  });
});

describe("parseWebhook", () => {
  it("reads call_started for the caller's number", () => {
    expect(parseWebhook('{"event":"call_started","room_name":"in-1","status":"dialing","phone_number":"+919800000001"}')).toMatchObject({
      kind: "started", call_id: "in-1", phone_number: "+919800000001", delivery_id: "call_started:in-1",
    });
  });

  it("maps call_postprocessing (documented example shape)", () => {
    const ev = parseWebhook(JSON.stringify({
      event: "call_postprocessing", call_id: "in-2", timestamp: "2026-10-09T05:00:55+00:00",
      data: { room_name: "in-2", call_id: "in-2", call_duration: 55150.02, end_reason: "Call ended", summary: "s",
        recording_url: "https://api.vaanivoice.ai/api/stream/in-2",
        transcript: "[10:30:00] AGENT: Hello, Aangan Studio.\n\n[10:30:05] USER: Hi, I'm Ritu from Baner.\n\n[10:30:20] USER: 3BHK, full home." },
    }));
    expect(ev.kind).toBe("postprocessed");
    if (ev.kind !== "postprocessed") return;
    expect(ev.event).toMatchObject({ vaani_call_id: "in-2", duration_s: 55, status: "completed", recording_url: "https://api.vaanivoice.ai/api/stream/in-2" });
    expect(ev.event.transcript).toBe("Agent: Hello, Aangan Studio.\nCaller: Hi, I'm Ritu from Baner.\nCaller: 3BHK, full home.");
    expect(ev.event.started_at).toBe(new Date(Date.parse("2026-10-09T05:00:55Z") - 55_000).toISOString());
  });

  it("treats a short call with one caller turn as dropped, and no transcript as missed", () => {
    const short = parseWebhook(JSON.stringify({ event: "call_postprocessing", call_id: "c", data: { call_duration: 9, transcript: "AGENT: Hello\nUSER: Hi, I wanted to —" } }));
    const none = parseWebhook(JSON.stringify({ event: "call_postprocessing", call_id: "d", data: { call_duration: 3000, transcript: "Transcript is not available for further evaluations." } }));
    expect(short.kind === "postprocessed" && short.event.status).toBe("dropped");
    expect(none.kind === "postprocessed" && none.event.status).toBe("missed");
  });

  it("ignores call_ended and unknown events", () => {
    expect(parseWebhook('{"event":"call_ended","room_name":"x","call_duration":4}').kind).toBe("ended");
    expect(parseWebhook('{"event":"user_picked_up_at","room_name":"x"}').kind).toBe("ignore");
  });
});

it("normaliseTranscript strips timestamps and relabels speakers", () => {
  expect(normaliseTranscript("[13:33:14] AGENT: Hi!\n\n[13:33:19] USER: Yeah.")).toEqual({ text: "Agent: Hi!\nCaller: Yeah.", userTurns: 1 });
});

it("parseToolRequest accepts top-level params, args, or a JSON string", () => {
  expect(parseToolRequest("qualify", '{"location":"Baner","sq_ft":1200}').args).toEqual({ location: "Baner", sq_ft: 1200 });
  expect(parseToolRequest("qualify", '{"call_id":"c","arguments":"{\\"location\\":\\"Baner\\"}"}')).toEqual({
    tool: "qualify", vaani_call_id: "c", caller_number: null, args: { location: "Baner" },
  });
});

it("reads the real 'send all call details' payload (duration in seconds, timestamps, web caller)", () => {
  const ev = parseWebhook(JSON.stringify({
    event: "call_postprocessing", call_id: "webrtc-1", timestamp: "2026-10-09T07:34:23.281718+00:00", from: "web-user",
    data: {
      call_id: "webrtc-1", call_type: "webrtc_call", phone_number: "web-user", call_duration: 107.42,
      call_started_at: "2026-10-09T07:31:17.602249+00:00", picked_up_at: "2026-10-09T07:31:17.018012+00:00",
      call_ended_at: "2026-10-09T07:33:05.534752+00:00",
      transcript: "AGENT: Hello\nUSER: I'm looking to design my two BHK.\nUSER: Near Koregaon Park.",
    },
  }));
  expect(ev.kind).toBe("postprocessed");
  if (ev.kind !== "postprocessed") return;
  expect(ev.event.duration_s).toBe(109); // picked_up_at → call_ended_at
  expect(ev.event.started_at).toBe("2026-10-09T07:31:17.602Z");
  expect(ev.event.caller_number).toBeNull(); // "web-user" isn't a number
  const phone = parseWebhook(JSON.stringify({ event: "call_postprocessing", call_id: "c", data: { phone_number: "+919800000001", call_duration: 60, transcript: "AGENT: hi\nUSER: a\nUSER: b" } }));
  expect(phone.kind === "postprocessed" && phone.event.caller_number).toBe("+919800000001");
  expect(phone.kind === "postprocessed" && phone.event.duration_s).toBe(60);
});
