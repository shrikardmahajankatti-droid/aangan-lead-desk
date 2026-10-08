import { rerunAnalysis } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/calls/[id]/rerun">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const out = await rerunAnalysis(id);
  return Response.json(out, { status: out.outcome === "error" ? 502 : 200 });
}
