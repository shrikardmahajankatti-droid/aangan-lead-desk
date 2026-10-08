// Splits the seed-transcript PDF text into enquiries. Header fields are parsed
// in code (never by Gemini). Pure functions: no I/O, unit-tested.

export type Channel = "phone" | "whatsapp" | "web_form";

export type CallLeg = {
  started_at: string; // ISO, Asia/Kolkata offset
  duration_s: number | null;
  status: "completed" | "dropped";
};

export type SeedEnquiry = {
  id: string; // T01, W05, F10
  channel: Channel;
  header: string;
  started_at: string | null; // ISO; first leg for merged calls
  duration_s: number | null; // total across legs
  status: "completed" | "missed" | "dropped";
  flags: { missed: boolean; escalate: boolean; merged: boolean };
  legs: CallLeg[];
  transcript: string; // conversation lines, wrapped lines re-joined
  notes: string | null; // "Note:" / "Status:" lines
  after_hours: boolean | null;
};

export type SplitResult = {
  year: number;
  enquiries: SeedEnquiry[];
  counts: { total: number; phone: number; whatsapp: number; web_form: number };
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const HEADER_RE = /^([TWF])(\d{2}) · (Phone|WhatsApp|Web Form) · (.*)$/;
const CHANNEL: Record<string, Channel> = { Phone: "phone", WhatsApp: "whatsapp", "Web Form": "web_form" };
// A new logical line starts with a speaker/label ("Front Desk:", "Note:", "Name:")
// or a WhatsApp timestamp ("4 Sept, 9:32am —"). Anything else is a wrapped continuation.
const LINE_START_RE =
  /^(?:[A-Z][A-Za-z .]{0,30}:\s|\d{1,2} Sept?, \d{1,2}:\d{2}[ap]m|\[|First call|Second call|Missed call)/;
const BUSINESS_HOURS = { start: 10 * 60, end: 19 * 60 }; // 10:00–19:00 IST

/** Removes PDF page markers and normalises whitespace/quotes. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/^-- \d+ of \d+ --$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Year from the document title, e.g. "Anonymised records · September 2026". */
export function documentYear(text: string): number {
  const head = text.slice(0, 400);
  const m = head.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (!m) throw new Error("Could not find the year in the document title");
  return Number(m[2]);
}

function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2]);
}

function parseDuration(s: string): number | null {
  const m = s.match(/(\d+)\s*min(?:\s*(\d+)\s*sec)?/i);
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
}

function istIso(year: number, month: number, day: number, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hh}:${mm}:00+05:30`;
}

function parseDayMonth(s: string): { day: number; month: number } | null {
  const m = s.trim().match(/^(\d{1,2})(?:[–-]\d{1,2})?\s+([A-Za-z]+)$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  return month < 0 ? null : { day: Number(m[1]), month };
}

function joinWrapped(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length === 0 || LINE_START_RE.test(line)) out.push(line);
    else out[out.length - 1] += " " + line;
  }
  return out;
}

function parseHeader(id: string, channel: Channel, rest: string, year: number, body: string[]) {
  const parts = rest.split(" · ").map((p) => p.trim());
  const dm = parseDayMonth(parts[0]);
  const flags = {
    missed: /MISSED CALL/i.test(rest),
    escalate: /ESCALATE/i.test(rest),
    merged: /\bthen\b/i.test(rest),
  };
  const legs: CallLeg[] = [];
  let started_at: string | null = null;
  let duration_s: number | null = null;
  let status: SeedEnquiry["status"] = "completed";
  let startMinutes: number | null = null;

  if (channel === "phone" && dm) {
    if (flags.merged) {
      // "2:14pm then 2:16pm" + body lines "First call — disconnected at 1 min 12 sec" / "Second call — 4 min 30 sec"
      const times = [...(parts[1] ?? "").matchAll(/(\d{1,2}:\d{2}\s*[ap]m)/gi)].map((m) => parseClock(m[1])!);
      const legLines = body.filter((l) => /^(First|Second) call/i.test(l));
      times.forEach((t, i) => {
        const line = legLines[i] ?? "";
        legs.push({
          started_at: istIso(year, dm.month, dm.day, t),
          duration_s: parseDuration(line),
          status: /disconnected|dropped|cut off/i.test(line) ? "dropped" : "completed",
        });
      });
      startMinutes = times[0] ?? null;
      started_at = legs[0]?.started_at ?? null;
      duration_s = legs.reduce((sum, l) => sum + (l.duration_s ?? 0), 0) || null;
    } else {
      startMinutes = parseClock(parts[1] ?? "");
      if (startMinutes !== null) started_at = istIso(year, dm.month, dm.day, startMinutes);
      if (flags.missed) status = "missed";
      else duration_s = parseDuration(parts[2] ?? "");
    }
  } else if (dm) {
    const t = parseClock(parts[1] ?? "");
    startMinutes = t;
    started_at = t === null ? istIso(year, dm.month, dm.day, 0).slice(0, 10) : istIso(year, dm.month, dm.day, t);
  }

  const after_hours =
    startMinutes === null ? null : startMinutes < BUSINESS_HOURS.start || startMinutes >= BUSINESS_HOURS.end;
  return { flags, legs, started_at, duration_s, status, after_hours };
}

export function splitEnquiries(rawText: string): SplitResult {
  const text = cleanText(rawText);
  const year = documentYear(text);
  const lines = text.split("\n");

  type Block = { id: string; channel: Channel; header: string; rest: string; body: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of lines) {
    const h = line.match(HEADER_RE);
    if (h) {
      current = { id: h[1] + h[2], channel: CHANNEL[h[3]], header: line, rest: h[4], body: [] };
      blocks.push(current);
    } else if (/^SECTION \d/.test(line)) {
      current = null; // section intro text belongs to no enquiry
    } else if (current) {
      current.body.push(line);
    }
  }

  const enquiries = blocks.map((b): SeedEnquiry => {
    const joined = joinWrapped(b.body);
    const notes = joined.filter((l) => /^(Note|Status):/.test(l));
    const convo = joined.filter((l) => !/^(Note|Status):/.test(l));
    const parsed = parseHeader(b.id, b.channel, b.rest, year, joined);
    return {
      id: b.id,
      channel: b.channel,
      header: b.header,
      ...parsed,
      transcript: convo.join("\n"),
      notes: notes.length ? notes.join("\n") : null,
    };
  });

  const count = (c: Channel) => enquiries.filter((e) => e.channel === c).length;
  return {
    year,
    enquiries,
    counts: { total: enquiries.length, phone: count("phone"), whatsapp: count("whatsapp"), web_form: count("web_form") },
  };
}
