// Checks VAANI_API_KEY against the public gateway WITHOUT minting a billable session:
// it sends deliberately malformed JSON, so a valid key should get 400 (bad request)
// and an invalid/unsupported key 401. Usage: npm run check:vaani
const key = process.env.VAANI_API_KEY;
if (!key) {
  console.error("VAANI_API_KEY is not set in .env.local");
  process.exit(1);
}
const prefix = key.includes("_") ? key.slice(0, key.lastIndexOf("_") + 1) : "(none)";
console.log(`Key prefix: ${prefix}  (docs expect vv_live_)`);
const res = await fetch("https://www.vaanilabs.in/api/public/v1/voicebot/session", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: "{not-json",
});
const body = (await res.text()).slice(0, 400);
console.log(`POST /api/public/v1/voicebot/session (malformed body) → ${res.status}\n${body}`);
if (res.status === 401) console.log("✗ Key rejected by the gateway.");
else if (res.status === 400) console.log("✓ Key accepted (auth passed, body rejected as intended).");
else if (res.status === 200) console.log("! A session was minted anyway; it expires unused.");
else console.log("? Unexpected status: check the message above.");
