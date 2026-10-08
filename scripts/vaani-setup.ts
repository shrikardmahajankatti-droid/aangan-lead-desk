// Builds the Vaani agent config from /context, version-controlled in /vaani.
//
// Vaani's public API (vaanilabs.in/openapi/v1/vaanivoice.yaml) has no endpoints to
// create agents/flows, register tools or webhooks: those live in the dashboard's
// Flow Builder. So this script writes the exact config to paste/enter there:
//   vaani/system-prompt.md   – the agent's instructions
//   vaani/agent-config.json  – greeting, languages, tools (URL + JSON schema), webhook
// If Vaani later documents a config API, push it from here.
//
// Usage: npm run vaani:config
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { LiveArgs, LINES } from "../src/lib/liveQualify";

const base = (process.env.APP_BASE_URL || "https://aangan-lead-desk.vercel.app").replace(/\/$/, "");
const read = (f: string) => readFileSync(`context/${f}`, "utf8");

const services = read("services.md").trim();
const logic = read("qualification_logic.md");
const pricing = read("pricing.md");

// Only the deflection line from pricing.md, never the price table.
const deflection = pricing.match(/\*\*The only acceptable response to a pricing question\*\*:\s*"([^"]+)"/)?.[1];
if (!deflection) throw new Error("Could not find the pricing deflection line in pricing.md");
if (/₹|\d+\s*(lakh|L\b)|per sq/i.test(deflection)) throw new Error("Deflection line contains a figure");

const liveSection = logic.match(/## On the live call[^\n]*\n([\s\S]*?)\n---/)?.[1]?.trim();
if (!liveSection) throw new Error('Could not find "On the live call" in qualification_logic.md');

const greeting = "Hello, Aangan Studio. How can I help you today?";

const systemPrompt = `# Aangan Studio – phone front desk

You answer every call to Aangan Studio, an interior design studio in Pune, 24×7. Greet with exactly:
"${greeting}"

Speak English by default. If the caller speaks Hindi or Marathi, reply in that language. Be warm, brief and natural: this is a phone call, so one or two sentences at a time.

## What to collect (naturally, not as an interrogation)
name · area/location · property type and size · scope (which rooms) · timeline · whether they decide (or are authorised).
Never ask about budget. If the caller volunteers a budget, note it (in lakh) and pass it to the qualify tool.
If they'd like a calendar invite, ask for an email address (optional).

## Answering "do you do X?"
Answer only from the services below. Never promise a service, timeline or result that isn't written here.

<services>
${services}
</services>

## Pricing: the hard rule
Never say any price, range, per-sq-ft figure, "starts at", "around", or a comparison like "for a 2BHK it's typically…". Not even if asked repeatedly.
For any pricing question, say exactly:
"${deflection}"
Then carry on. Asking about price never disqualifies a caller.

## Existing clients with a complaint
If the caller is an existing client unhappy about an ongoing project: apologise, take their name, project and what's wrong, then call **qualify** with is_existing_client_complaint = true and say its \`say\` line. Do not try to qualify them or book a consultation.

## Qualifying and booking
1. Once you know the area and the scope (or as soon as it's clearly a complaint), call **qualify** with everything collected so far.
2. Do what its response says:
   - \`offer_booking: true\` → call **get_slots**, read the options from its \`say\`, let the caller choose, then call **book_slot** with that \`slot_id\` and read back its \`say\` (the confirmation).
   - \`ask_next\` present → ask exactly that one question, then call **qualify** again with the answer.
   - otherwise → say its \`say\` line politely and close the call. Do not offer a booking.
3. If a tool fails or returns \`booking_pending\`, say: "${LINES.fallback}" and close warmly.
Only offer a consultation when qualify returned \`offer_booking: true\`.

## Lines from the studio's rulebook (qualification_logic.md, "On the live call")
${liveSection}

## Never
- state any price or figure (see above)
- mention scores, gates, "qualification" or internal notes
- promise a callback time other than 15 minutes for complaints
- invent the caller's details
`;

const toolSchema = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: "input" }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

const config = {
  _note:
    "Enter this in the Vaani dashboard (Flow Builder). Every tool and the webhook must be signed with the webhook secret (X-VaaniVoice-Signature: sha256=<hex HMAC of raw body>), matching VAANI_WEBHOOK_SECRET in Vercel.",
  name: "Aangan Studio – Front Desk",
  greeting,
  languages: ["en-IN", "hi-IN", "mr-IN"],
  language_policy: "Start in English; switch to the caller's language (Hindi/Marathi) if they use it. Use only languages Vaani supports.",
  system_prompt_file: "vaani/system-prompt.md",
  tools: [
    {
      name: "qualify",
      description: "Check the enquiry against the studio's rules. Call once area and scope are known, again after an ask_next answer, or immediately for an existing-client complaint.",
      method: "POST",
      url: `${base}/api/vaani/qualify`,
      timeout_ms: 3000,
      parameters: toolSchema(LiveArgs),
    },
    {
      name: "get_slots",
      description: "Get three open consultation times (next 7 days, studio hours). Only after qualify returned offer_booking: true.",
      method: "POST",
      url: `${base}/api/vaani/slots`,
      timeout_ms: 3000,
      parameters: { type: "object", properties: {} },
    },
    {
      name: "book_slot",
      description: "Book the consultation the caller chose. Re-checks the time is still free and sends calendar invites.",
      method: "POST",
      url: `${base}/api/vaani/book`,
      timeout_ms: 3000,
      parameters: toolSchema(
        z.object({
          slot_id: z.string().describe("slot_id from get_slots"),
          caller_name: z.string().nullish(),
          location: z.string().nullish(),
          caller_email: z.string().nullish().describe("Only if the caller gave one"),
          caller_phone: z.string().nullish(),
        }),
      ),
    },
  ],
  tool_request_shape: "JSON body; arguments under `args` (or `arguments`), plus `call_id` and `caller_number` if Vaani can include them.",
  tool_response_shape: "JSON; the agent should speak the `say` field.",
  webhook: { url: `${base}/api/vaani/call-ended`, events: ["call.completed", "call.failed"] },
};

mkdirSync("vaani", { recursive: true });
writeFileSync("vaani/system-prompt.md", systemPrompt);
writeFileSync("vaani/agent-config.json", JSON.stringify(config, null, 2) + "\n");

// Guardrail check: the agent prompt must carry no pricing figures.
const leaks = systemPrompt.match(/₹\s?[\d,]+|\d[\d,]*\s*(?:lakh|L)\b|per sq ?ft\s*[:=]?\s*₹?\d/gi);
if (leaks) {
  console.error("✗ Pricing figures found in the agent prompt:", leaks);
  process.exit(1);
}
console.log(`✓ vaani/system-prompt.md (${systemPrompt.length} chars, no pricing figures)`);
console.log(`✓ vaani/agent-config.json (tools → ${base}/api/vaani/*)`);
