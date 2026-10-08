import { deliver } from "@/lib/deliver";

export const maxDuration = 60;

/** Re-attempts the HubSpot push if pending/failed/dry run. A synced lead is never pushed again. */
export async function POST(_req: Request, ctx: RouteContext<"/api/calls/[id]/retry-hubspot">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const r = await deliver(id, "hubspot");
  return Response.json(r.hubspot ? r : { hubspot: { status: "done", detail: "Nothing to push (already synced, or not applicable)" } });
}
