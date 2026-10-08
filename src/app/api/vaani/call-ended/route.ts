import { after } from "next/server";
import { verifiedWebhookBody, parseWebhook, VaaniAuthError } from "@/lib/vaani/adapter";
import { acceptCallEnded, recordCallStart } from "@/lib/vaani/handlers";

// Vaani expects a reply within 5 s, so acknowledge fast and process after the response.
export const maxDuration = 300;

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await verifiedWebhookBody(req);
  } catch (e) {
    const status = e instanceof VaaniAuthError ? 401 : 500;
    return Response.json({ error: status === 401 ? "unauthorized" : "server misconfigured" }, { status });
  }
  let ev;
  try {
    ev = parseWebhook(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (ev.kind === "ignore" || ev.kind === "ended") return Response.json({ ok: true, ignored: ev.kind === "ignore" ? ev.reason : "call_ended" });
  if (ev.kind === "started") {
    await recordCallStart(ev);
    return Response.json({ ok: true });
  }

  const accepted = await acceptCallEnded(ev.event, "vaani");
  if (accepted.duplicate) return Response.json({ ok: true, duplicate: true });
  after(async () => {
    try {
      await accepted.work();
    } catch (e) {
      console.error("call processing failed:", (e as Error).message);
    }
  });
  return Response.json({ ok: true, accepted: ev.delivery_id });
}
