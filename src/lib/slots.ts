// Pure slot maths for consultation booking (IST). No I/O, unit-tested.

export type Busy = { start: string; end: string };
export type Slot = { id: string; start: string; end: string; speech: string };

const IST_OFFSET_MIN = 330;
/** Consultations are booked Monday–Friday only (confirmed by the studio). */
const BOOKING_DAYS = new Set([1, 2, 3, 4, 5]);

/** Wall-clock IST parts for an instant. */
function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
function istInstant(y: number, m: number, day: number, minutes: number): Date {
  return new Date(Date.UTC(y, m, day, 0, minutes) - IST_OFFSET_MIN * 60_000);
}

export function parseHours(hours: string): { open: number; close: number } {
  const [a, b] = hours.split("-");
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return { open: toMin(a), close: toMin(b) };
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thursday 9 October at 11 am" / "… at 2:30 pm" — written for a voice agent to read out. */
export function speakSlot(start: Date, now: Date): string {
  const p = istParts(start);
  const today = istParts(now);
  const tomorrow = istParts(new Date(now.getTime() + 86_400_000));
  const h24 = Math.floor(p.min / 60);
  const mm = p.min % 60;
  const h12 = h24 % 12 || 12;
  const time = `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 < 12 ? "am" : "pm"}`;
  const sameDay = (a: typeof p) => a.y === p.y && a.m === p.m && a.day === p.day;
  const dayName = sameDay(today) ? "today" : sameDay(tomorrow) ? `tomorrow, ${DAYS[p.dow]}` : DAYS[p.dow];
  return `${dayName} ${p.day} ${MONTHS[p.m]} at ${time}`;
}

const overlaps = (s: number, e: number, busy: { s: number; e: number }[]) => busy.some((b) => s < b.e && e > b.s);

/**
 * Up to `count` free slots in the next `days` days, Monday–Friday within business hours (IST),
 * at most one per day so the caller gets real choices, earliest first.
 * Slots start on the hour and need `leadMin` notice.
 */
export function findSlots(o: {
  now: Date;
  busy: Busy[];
  hours: string;
  durationMin: number;
  days?: number;
  count?: number;
  leadMin?: number;
}): Slot[] {
  const { open, close } = parseHours(o.hours);
  const busy = o.busy.map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) }));
  const earliest = o.now.getTime() + (o.leadMin ?? 120) * 60_000;
  const today = istParts(o.now);
  const out: Slot[] = [];

  for (let d = 0; d < (o.days ?? 7) && out.length < (o.count ?? 3); d++) {
    if (!BOOKING_DAYS.has(istParts(istInstant(today.y, today.m, today.day + d, 12 * 60)).dow)) continue;
    for (let m = open; m + o.durationMin <= close; m += 60) {
      const start = istInstant(today.y, today.m, today.day + d, m);
      const end = new Date(start.getTime() + o.durationMin * 60_000);
      if (start.getTime() < earliest || overlaps(start.getTime(), end.getTime(), busy)) continue;
      out.push({ id: start.toISOString(), start: start.toISOString(), end: end.toISOString(), speech: speakSlot(start, o.now) });
      break; // one per day
    }
  }
  return out;
}

/** The window freebusy must cover for findSlots. */
export function searchWindow(now: Date, days = 7) {
  const p = istParts(now);
  return { timeMin: now.toISOString(), timeMax: istInstant(p.y, p.m, p.day + days, 0).toISOString() };
}

/** Is a requested slot still inside business hours and free? */
export function slotStillFree(slotStart: string, durationMin: number, hours: string, busy: Busy[], now: Date): boolean {
  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime()) || start.getTime() < now.getTime()) return false;
  const { open, close } = parseHours(hours);
  const p = istParts(start);
  if (!BOOKING_DAYS.has(p.dow)) return false;
  if (p.min < open || p.min + durationMin > close) return false;
  return !overlaps(start.getTime(), start.getTime() + durationMin * 60_000, busy.map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) })));
}
