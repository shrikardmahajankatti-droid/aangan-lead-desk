import { deliver } from "@/lib/deliver";

export const maxDuration = 60;

/** Re-attempts the designer/escalation email if it's pending, failed or a dry run. A sent email is never re-sent. */
export async function POST(_req: Request, ctx: RouteContext<"/api/calls/[id]/resend">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const r = await deliver(id, "email");
  return Response.json(r.email ? r : { email: { status: "done", detail: "Nothing to send (already sent, or not applicable)" } });
}
