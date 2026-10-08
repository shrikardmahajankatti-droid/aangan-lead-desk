import "server-only";
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";
import { sql } from "./db";
import { env, isDryRun } from "./env";
import { runOnce } from "./actions";
import { findSlots, searchWindow, slotStillFree, speakSlot, type Busy, type Slot } from "./slots";

// OAuth with the studio's own Google account (refresh token), not a service account:
// a service account can't invite attendees without Workspace domain-wide delegation.
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

let api: calendar_v3.Calendar | null = null;
function cal(): calendar_v3.Calendar {
  if (api) return api;
  const g = env("google");
  const auth = new OAuth2Client({ clientId: g.GOOGLE_CLIENT_ID, clientSecret: g.GOOGLE_CLIENT_SECRET });
  auth.setCredentials({ refresh_token: g.GOOGLE_REFRESH_TOKEN });
  api = calendar({ version: "v3", auth });
  return api;
}

async function busyBetween(timeMin: string, timeMax: string, timeoutMs: number): Promise<Busy[]> {
  const g = env("google");
  const res = await cal().freebusy.query(
    { requestBody: { timeMin, timeMax, timeZone: "Asia/Kolkata", items: [{ id: g.GOOGLE_CALENDAR_ID }] } },
    { timeout: timeoutMs },
  );
  const entry = res.data.calendars?.[g.GOOGLE_CALENDAR_ID];
  if (entry?.errors?.length) throw new Error(`freebusy: ${entry.errors.map((e) => e.reason).join(", ")}`);
  return (entry?.busy ?? []).map((b) => ({ start: b.start!, end: b.end! }));
}

/** Next 3 open consultation slots (one per day), phrased for speech. */
export async function getSlots(opts: { timeoutMs?: number; now?: Date } = {}): Promise<Slot[]> {
  const g = env("google");
  const now = opts.now ?? new Date();
  const w = searchWindow(now, 7);
  const busy = await busyBetween(w.timeMin, w.timeMax, opts.timeoutMs ?? 2500);
  return findSlots({ now, busy, hours: g.CONSULT_HOURS, durationMin: g.CONSULT_DURATION_MIN });
}

export type BookInput = {
  vaani_call_id: string | null;
  call_id?: string | null;
  slot_start: string;
  caller_name: string | null;
  caller_phone: string | null;
  caller_email: string | null;
  location: string | null;
};
export type BookResult =
  | { ok: true; event_id: string; html_link: string | null; dry_run: boolean; confirmation_line: string }
  | { ok: false; reason: "slot_taken" | "already_booked" | "error"; confirmation_line: string };

/** Re-checks the slot, then creates the event with the designer and caller as attendees. */
export async function bookSlot(b: BookInput, opts: { timeoutMs?: number; now?: Date } = {}): Promise<BookResult> {
  const dry = isDryRun();
  // In dry run, Google credentials are optional: we only log what would be booked.
  let g: ReturnType<typeof env<"google">>;
  try {
    g = env("google");
  } catch (e) {
    if (!dry) throw e;
    g = {
      GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REFRESH_TOKEN: "", GOOGLE_CALENDAR_ID: "(GOOGLE_CALENDAR_ID not set)",
      CONSULT_DURATION_MIN: Number(process.env.CONSULT_DURATION_MIN || 60), CONSULT_HOURS: process.env.CONSULT_HOURS || "10:00-19:00",
    };
  }
  const haveGoogle = Boolean(g.GOOGLE_REFRESH_TOKEN);
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? 2500;
  const end = new Date(Date.parse(b.slot_start) + g.CONSULT_DURATION_MIN * 60_000).toISOString();
  const spoken = speakSlot(new Date(b.slot_start), now);

  if (b.vaani_call_id) {
    const [existing] = (await sql()`
      select event_id, slot_start from bookings where vaani_call_id = ${b.vaani_call_id} and status in ('booked', 'dry_run') limit 1`) as {
      event_id: string;
      slot_start: string;
    }[];
    if (existing)
      return { ok: false, reason: "already_booked", confirmation_line: `You're already booked: ${speakSlot(new Date(existing.slot_start), now)}.` };
  }

  const busy = haveGoogle ? await busyBetween(b.slot_start, end, timeoutMs) : [];
  if (!slotStillFree(b.slot_start, g.CONSULT_DURATION_MIN, g.CONSULT_HOURS, busy, now)) {
    return { ok: false, reason: "slot_taken", confirmation_line: "Sorry, that time has just been taken. Let me check the next available times." };
  }

  const baseUrl = env("app").APP_BASE_URL.replace(/\/$/, "");
  const link = b.call_id ? `${baseUrl}/calls/${b.call_id}` : b.vaani_call_id ? `${baseUrl}/calls/vaani/${encodeURIComponent(b.vaani_call_id)}` : baseUrl;
  const designer = process.env.DESIGNER_EMAIL;
  const requestBody: calendar_v3.Schema$Event = {
    summary: `Consultation – ${b.caller_name ?? "New caller"}${b.location ? `, ${b.location}` : ""}`,
    description: [b.caller_phone ? `Phone: ${b.caller_phone}` : "Phone: not captured", `Call record: ${link}`, "Booked by the Aangan Lead Desk."].join("\n"),
    start: { dateTime: b.slot_start, timeZone: "Asia/Kolkata" },
    end: { dateTime: end, timeZone: "Asia/Kolkata" },
    attendees: [designer, b.caller_email].filter((e): e is string => Boolean(e)).map((email) => ({ email })),
  };

  if (dry) {
    const fakeId = `dry-${Date.now()}`;
    await sql()`
      insert into bookings (call_id, vaani_call_id, event_id, slot_start, slot_end, caller_name, caller_email, status)
      values (${b.call_id ?? null}, ${b.vaani_call_id}, ${fakeId}, ${b.slot_start}, ${end}, ${b.caller_name}, ${b.caller_email}, 'dry_run')`;
    await sql()`insert into actions (call_id, type, status, idempotency_key, external_id, payload)
      values (${b.call_id ?? null}, 'calendar', 'dry_run', ${`calendar:${b.vaani_call_id ?? fakeId}`}, ${fakeId},
        ${JSON.stringify({ calendarId: g.GOOGLE_CALENDAR_ID, sendUpdates: "all", requestBody })})`;
    return { ok: true, event_id: fakeId, html_link: null, dry_run: true, confirmation_line: confirmation(spoken, b.caller_email) };
  }

  // At most one live event per call, even if the agent calls book twice at once.
  const key = `calendar:${b.vaani_call_id ?? `${b.caller_phone ?? "anon"}:${b.slot_start}`}`;
  const r = await runOnce({ callId: b.call_id ?? null, type: "calendar", key, dryRun: false, payload: { requestBody } }, async () => {
    const res = await cal().events.insert({ calendarId: g.GOOGLE_CALENDAR_ID, sendUpdates: "all", requestBody }, { timeout: timeoutMs });
    return { external_id: res.data.id ?? null, result: res.data };
  });
  if (r.status === "skipped") return { ok: false, reason: "already_booked", confirmation_line: "You're already booked. Our designer will see you then." };
  if (r.status !== "success") throw new Error(r.status === "error" ? r.error : "calendar insert did not run");
  const ev = r.result;
  await sql()`
    insert into bookings (call_id, vaani_call_id, event_id, html_link, slot_start, slot_end, caller_name, caller_email, status)
    values (${b.call_id ?? null}, ${b.vaani_call_id}, ${ev.id}, ${ev.htmlLink ?? null}, ${b.slot_start}, ${end}, ${b.caller_name}, ${b.caller_email}, 'booked')`;
  return { ok: true, event_id: ev.id!, html_link: ev.htmlLink ?? null, dry_run: false, confirmation_line: confirmation(spoken, b.caller_email) };
}

function confirmation(spoken: string, email: string | null) {
  const when = /^(today|tomorrow)/.test(spoken) ? spoken : `on ${spoken}`;
  return `You're booked for a free consultation ${when}. ${email ? "A calendar invite is on its way to your email. " : ""}Our designer will see you then.`;
}
