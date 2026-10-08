import type { Metadata } from "next";
import { UploadFlow } from "./upload-flow";

export const metadata: Metadata = { title: "Upload seed PDF · Aangan Lead Desk" };

export default function UploadPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Upload seed transcripts</h1>
      <p className="mt-1 text-sm text-stone-500">
        The PDF is split into enquiries in code. Only phone calls are processed; WhatsApp and web form
        enquiries are counted as out of scope. Seed records never book a consultation. Re-uploading the same
        file changes nothing.
      </p>
      <UploadFlow />
    </main>
  );
}
