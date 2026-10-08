import { saveUpload } from "@/lib/seed";

export const maxDuration = 60;

/** POST multipart (file) → parse + split + store. Returns the preview; nothing is processed yet. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach the PDF as 'file'" }, { status: 400 });
  if (file.type && file.type !== "application/pdf") return Response.json({ error: "Expected a PDF" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "PDF too large (max 10 MB)" }, { status: 413 });
  try {
    return Response.json(await saveUpload(new Uint8Array(await file.arrayBuffer())));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
