import { after } from "next/server";
import { verifiedBody, parseCallEnded, VaaniAuthError } from "@/lib/vaani/adapter";
import { acceptCallEnded } from "@/lib/vaani/handlers";

// Vaani times out each delivery after 10 s, so acknowledge fast and process after the response.
export const maxDuration = 300;

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await verifiedBody(req);
  } catch (e) {
    const status = e instanceof VaaniAuthError ? 401 : 500;
    return Response.json({ error: status === 401 ? "unauthorized" : "server misconfigured" }, { status });
  }
  let event;
  try {
    event = parseCallEnded(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if ("ignore" in event) return Response.json({ ok: true, ignored: event.ignore });

  const accepted = await acceptCallEnded(event, "vaani");
  if (accepted.duplicate) return Response.json({ ok: true, duplicate: true });
  after(async () => {
    try {
      await accepted.work();
    } catch (e) {
      console.error("call-ended processing failed:", (e as Error).message);
    }
  });
  return Response.json({ ok: true, accepted: event.event_id });
}
