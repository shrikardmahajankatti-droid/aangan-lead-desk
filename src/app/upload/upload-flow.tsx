"use client";

import Link from "next/link";
import { useState } from "react";

type Preview = {
  upload_id: string;
  year: number;
  counts: { total: number; phone: number; whatsapp: number; web_form: number };
  phone: { id: string; header: string; already_processed: boolean }[];
};
type RowState = { state: "queued" | "running" | "done" | "error"; detail?: string; callId?: string };

export function UploadFlow() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState<"parsing" | "processing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setPreview(null);
    setRows({});
    setBusy("parsing");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setPreview(json);
      setRows(
        Object.fromEntries(
          (json as Preview).phone.map((p) => [p.id, { state: p.already_processed ? "done" : "queued", detail: p.already_processed ? "already processed" : undefined }]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function processAll() {
    if (!preview) return;
    setBusy("processing");
    // Sequential: the Gemini free tier allows 5 requests/min per model.
    for (const p of preview.phone) {
      if (rows[p.id]?.state === "done") continue;
      setRows((r) => ({ ...r, [p.id]: { state: "running" } }));
      try {
        const res = await fetch(`/api/upload/${preview.upload_id}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enquiry_id: p.id }),
        });
        const out = await res.json();
        const failed = !res.ok || out.outcome === "error";
        const detail = failed
          ? (out.error ?? "failed").slice(0, 140)
          : [out.outcome === "duplicate" ? "already processed" : null, out.record_type, out.verdict].filter(Boolean).join(" · ");
        setRows((r) => ({ ...r, [p.id]: { state: failed ? "error" : "done", detail, callId: out.call_id } }));
      } catch (e) {
        setRows((r) => ({ ...r, [p.id]: { state: "error", detail: (e as Error).message } }));
      }
    }
    setBusy(null);
  }

  const remaining = preview ? preview.phone.filter((p) => rows[p.id]?.state !== "done").length : 0;
  const doneCount = preview ? preview.phone.length - remaining : 0;

  return (
    <div className="mt-6 space-y-6">
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white px-4 py-8 text-sm hover:border-accent dark:border-stone-700 dark:bg-stone-900">
        <span className="font-medium">{busy === "parsing" ? "Reading PDF…" : "Choose the enquiries PDF"}</span>
        <span className="mt-1 text-stone-500">e.g. Aangan_Sep 2026_Enquiries.pdf</span>
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy !== null}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {preview && (
        <section className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <p className="text-sm">
            Found <b>{preview.counts.total}</b>: {preview.counts.phone} phone, {preview.counts.whatsapp} WhatsApp,{" "}
            {preview.counts.web_form} web form <span className="text-stone-500">({preview.year})</span>.
          </p>
          <p className="mt-1 text-sm text-stone-500">
            {preview.counts.whatsapp + preview.counts.web_form} WhatsApp / web form enquiries are out of scope and
            will not be processed.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={processAll}
              disabled={busy !== null || remaining === 0}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {remaining === 0
                ? "All phone calls processed"
                : busy === "processing"
                  ? `Processing… ${doneCount}/${preview.phone.length}`
                  : `Process ${remaining} phone call${remaining === 1 ? "" : "s"}?`}
            </button>
            {doneCount > 0 && (
              <Link href="/" className="text-sm text-accent underline-offset-2 hover:underline">
                Open dashboard
              </Link>
            )}
          </div>

          <ul className="mt-4 divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {preview.phone.map((p) => {
              const r = rows[p.id];
              return (
                <li key={p.id} className="flex items-center gap-3 py-1.5">
                  <span className="w-5 text-center" aria-hidden>
                    {r?.state === "done" ? "✓" : r?.state === "error" ? "✗" : r?.state === "running" ? "…" : "·"}
                  </span>
                  <span className="w-10 font-mono">{p.id}</span>
                  <span className="flex-1 truncate text-stone-500">{p.header.replace(/^T\d{2} · Phone · /, "")}</span>
                  <span className={r?.state === "error" ? "text-red-600" : "text-stone-600 dark:text-stone-400"}>
                    {r?.callId && r.state === "done" ? (
                      <Link href={`/calls/${r.callId}`} className="hover:underline">{r.detail}</Link>
                    ) : (
                      r?.detail
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
