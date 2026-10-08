import { processUploadedEnquiry } from "@/lib/seed";

// One enquiry per request keeps each run well inside the function limit,
// including a ~60 s wait when the Gemini free tier rate-limits.
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/upload/[id]/process">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Upload not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { enquiry_id?: string };
  if (!body.enquiry_id) return Response.json({ error: "enquiry_id required" }, { status: 400 });
  try {
    return Response.json(await processUploadedEnquiry(id, body.enquiry_id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
