// Books ONE live test consultation through the same code path as the agent's book_slot tool.
// Usage: DRY_RUN=false npm run calendar:test-book
import { getSlots, bookSlot } from "../src/lib/calendar";

const slots = await getSlots({ timeoutMs: 10_000 });
const slot = slots.find((s) => !s.speech.startsWith("today")) ?? slots[0];
if (!slot) throw new Error("No free slot found");
console.log(`Booking "${slot.speech}" (${slot.start})…`);
const first = await bookSlot(
  { vaani_call_id: "test-calendar-booking-1", slot_start: slot.start, caller_name: "Test Caller", caller_phone: null, caller_email: null, location: "Baner" },
  { timeoutMs: 10_000 },
);
console.log("first attempt :", JSON.stringify(first));
const again = await bookSlot(
  { vaani_call_id: "test-calendar-booking-1", slot_start: slot.start, caller_name: "Test Caller", caller_phone: null, caller_email: null, location: "Baner" },
  { timeoutMs: 10_000 },
);
console.log("second attempt:", JSON.stringify(again));
