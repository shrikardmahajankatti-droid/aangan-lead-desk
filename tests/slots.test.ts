import { describe, it, expect } from "vitest";
import { findSlots, slotStillFree, speakSlot } from "@/lib/slots";

// Wed 8 Oct 2026, 15:00 IST
const now = new Date("2026-10-08T15:00:00+05:30");

describe("findSlots", () => {
  it("offers 3 slots, one per day, inside 10:00–19:00 IST with 2 h notice", () => {
    const s = findSlots({ now, busy: [], hours: "10:00-19:00", durationMin: 60 });
    expect(s.map((x) => x.start)).toEqual([
      new Date("2026-10-08T17:00:00+05:30").toISOString(), // today 5 pm (≥ 2 h from 3 pm)
      new Date("2026-10-09T10:00:00+05:30").toISOString(),
      new Date("2026-10-10T10:00:00+05:30").toISOString(),
    ]);
    expect(s[0].speech).toBe("today 8 October at 5 pm");
    expect(s[1].speech).toBe("tomorrow, Friday 9 October at 10 am");
  });

  it("skips busy times and a fully busy day", () => {
    const busy = [
      { start: "2026-10-08T16:30:00+05:30", end: "2026-10-08T19:00:00+05:30" }, // rest of today
      { start: "2026-10-09T09:00:00+05:30", end: "2026-10-09T12:15:00+05:30" }, // Fri morning
    ];
    const s = findSlots({ now, busy, hours: "10:00-19:00", durationMin: 60 });
    expect(s[0].speech).toBe("tomorrow, Friday 9 October at 1 pm");
    expect(s).toHaveLength(3);
  });

  it("never ends a slot after closing", () => {
    const late = new Date("2026-10-08T17:30:00+05:30");
    const s = findSlots({ now: late, busy: [], hours: "10:00-19:00", durationMin: 60 });
    expect(s[0].speech).toBe("tomorrow, Friday 9 October at 10 am");
  });
});

describe("slotStillFree", () => {
  const slot = new Date("2026-10-09T11:00:00+05:30").toISOString();
  it("accepts a free in-hours slot", () => expect(slotStillFree(slot, 60, "10:00-19:00", [], now)).toBe(true));
  it("rejects a now-busy slot", () =>
    expect(slotStillFree(slot, 60, "10:00-19:00", [{ start: "2026-10-09T11:30:00+05:30", end: "2026-10-09T12:00:00+05:30" }], now)).toBe(false));
  it("rejects out-of-hours and past slots", () => {
    expect(slotStillFree(new Date("2026-10-09T18:30:00+05:30").toISOString(), 60, "10:00-19:00", [], now)).toBe(false);
    expect(slotStillFree(new Date("2026-10-07T11:00:00+05:30").toISOString(), 60, "10:00-19:00", [], now)).toBe(false);
  });
});

it("speaks half hours", () => expect(speakSlot(new Date("2026-10-13T14:30:00+05:30"), now)).toBe("Tuesday 13 October at 2:30 pm"));
