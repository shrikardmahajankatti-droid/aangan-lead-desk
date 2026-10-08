import "server-only";
import { createHash } from "node:crypto";
import { sql } from "./db";
import { splitEnquiries, type SeedEnquiry, type SplitResult } from "./pdfSplit";
import { processCall, type CallRecord, type ProcessOutcome } from "./pipeline";

export async function pdfToText(data: Uint8Array): Promise<string> {
  // pdf-parse v2. The worker import must come first in serverless runtimes.
  await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  // pdf.js transfers (detaches) the buffer it is given, so hand it a copy.
  const parser = new PDFParse({ data: data.slice() });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export function seedToRecord(e: SeedEnquiry): CallRecord {
  return {
    source: "seed",
    external_id: e.id,
    header: e.header,
    caller_number: null, // anonymised in the seed data
    started_at: e.started_at,
    duration_s: e.duration_s,
    status: e.status,
    flags: { escalate: e.flags.escalate, merged: e.flags.merged },
    legs: e.legs,
    transcript: e.transcript || null,
    notes: e.notes,
    after_hours: e.after_hours,
    raw_payload: { header: e.header, legs: e.legs, flags: e.flags },
  };
}

export type SeedPreview = { file_hash: string; year: number; counts: SplitResult["counts"]; phone_ids: string[] };

export async function previewSeed(data: Uint8Array): Promise<SeedPreview & { split: SplitResult }> {
  const split = splitEnquiries(await pdfToText(data));
  return {
    file_hash: createHash("sha256").update(data).digest("hex"),
    year: split.year,
    counts: split.counts,
    phone_ids: split.enquiries.filter((e) => e.channel === "phone").map((e) => e.id),
    split,
  };
}

/** Processes the phone enquiries only. WhatsApp / web form are counted as out_of_scope_channel. */
export async function processSeed(data: Uint8Array, opts: { concurrency?: number; only?: string[] } = {}) {
  const preview = await previewSeed(data);
  const { counts, file_hash } = preview;
  await sql()`
    insert into seed_uploads (file_hash, total, phone, whatsapp, web_form)
    values (${file_hash}, ${counts.total}, ${counts.phone}, ${counts.whatsapp}, ${counts.web_form})
    on conflict (file_hash) do nothing`;

  const phone = preview.split.enquiries.filter(
    (e) => e.channel === "phone" && (!opts.only || opts.only.includes(e.id)),
  );
  const results = await mapLimit(phone, opts.concurrency ?? 4, (e) => processCall(seedToRecord(e)));
  return { preview: { ...preview, split: undefined }, results };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type { ProcessOutcome };
