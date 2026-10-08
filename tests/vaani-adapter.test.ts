import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.VAANI_WEBHOOK_SECRET = "vv_whk_test";
});

const { verifiedBody, sign, parseCallEnded, parseToolRequest, VaaniAuthError } = await import("@/lib/vaani/adapter");

const req = (body: string, sig?: string) =>
  new Request("http://x/api/vaani/call-ended", { method: "POST", body, headers: sig ? { "x-vaanivoice-signature": sig } : {} });

describe("signature", () => {
  it("accepts the documented sha256=<hex> HMAC of the raw body", async () => {
    const raw = '{"id":"evt_1","type":"call.completed","created":1,"data":{}}';
    expect(await verifiedBody(req(raw, sign(raw, "vv_whk_test")))).toBe(raw);
  });
  it("rejects missing, malformed and wrong signatures", async () => {
    const raw = "{}";
    await expect(verifiedBody(req(raw))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedBody(req(raw, "deadbeef"))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedBody(req(raw, sign(raw, "other-secret")))).rejects.toBeInstanceOf(VaaniAuthError);
    await expect(verifiedBody(req(raw + " ", sign(raw, "vv_whk_test")))).rejects.toBeInstanceOf(VaaniAuthError);
  });
});

describe("parseCallEnded (defensive)", () => {
  it("maps a completed call with a message-array transcript", () => {
    const e = parseCallEnded(JSON.stringify({
      id: "evt_9", type: "call.completed", created: 1791480000,
      data: { call_id: "c1", from: "+91 98XXX XX123", duration_seconds: 245.4, recording_url: "https://r/1.mp3",
        transcript: [{ role: "assistant", text: "Hello, Aangan Studio." }, { role: "user", content: "Hi, I'm Ritu." }] },
    }));
    expect("ignore" in e).toBe(false);
    if ("ignore" in e) return;
    expect(e).toMatchObject({ event_id: "evt_9", vaani_call_id: "c1", status: "completed", duration_s: 245, recording_url: "https://r/1.mp3" });
    expect(e.transcript).toBe("Agent: Hello, Aangan Studio.\nCaller: Hi, I'm Ritu.");
    expect(e.started_at).toBe(new Date(1791480000 * 1000).toISOString());
  });
  it("treats call.failed without a transcript as missed, and a dropped status as dropped", () => {
    const m = parseCallEnded(JSON.stringify({ id: "e", type: "call.failed", created: 1, data: { call_id: "c2" } }));
    const d = parseCallEnded(JSON.stringify({ id: "e2", type: "call.completed", created: 1, data: { call_id: "c3", status: "disconnected", transcript: "Caller: Hi —" } }));
    expect("ignore" in m ? null : m.status).toBe("missed");
    expect("ignore" in d ? null : d.status).toBe("dropped");
  });
  it("ignores pings and other events", () => {
    expect(parseCallEnded('{"id":"p","type":"webhook.ping","created":1,"data":{}}')).toMatchObject({ ignore: "event type webhook.ping" });
  });
});

it("parseToolRequest accepts args/arguments (object or JSON string)", () => {
  expect(parseToolRequest("qualify", '{"call_id":"c","arguments":"{\\"location\\":\\"Baner\\"}"}')).toEqual({
    tool: "qualify", vaani_call_id: "c", caller_number: null, args: { location: "Baner" },
  });
});
