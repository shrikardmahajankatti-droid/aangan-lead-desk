// Shows the next 3 slots from Google Calendar free/busy (read-only).
// Usage: npm run calendar:check
import { getSlots } from "../src/lib/calendar";
const slots = await getSlots({ timeoutMs: 10_000 });
for (const s of slots) console.log(`${s.start}  →  "${s.speech}"`);
