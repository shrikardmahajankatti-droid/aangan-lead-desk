import { z } from "zod";
import { overrideVerdict } from "@/lib/pipeline";

export const maxDuration = 60;

const Body = z.object({
  verdict: z.enum(["qualified", "not_qualified", "nurture", "needs_info"]),
  note: z.string().max(500).nullish(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/calls/[id]/override">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: z.prettifyError(b.error) }, { status: 400 });
  try {
    return Response.json(await overrideVerdict(id, b.data.verdict, b.data.note?.trim() || null));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
