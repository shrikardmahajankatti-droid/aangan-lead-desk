// Builds the Vaani agent from /context and (with --apply) creates or updates it via the
// Vaani AI API (docs.vaanivoice.ai): POST /api/create-agent, PATCH /api/agent/{id}/persona.
// Also writes the config to /vaani so it's version-controlled.
//
// Custom tools are created in the dashboard (Tools & Actions); their request format is
// not in the public API. vaani/agent-config.json lists exactly what to enter.
//
// Usage: npm run vaani:config            (write files only)
//        npm run vaani:config -- --apply (create the agent, or update it if VAANI_AGENT_ID is set)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VAANI_API, TOOL_SECRET_HEADER } from "../src/lib/vaani/adapter";
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
If the caller is an existing client unhappy about an ongoing project: apologise, take their name, project and what's wrong, then call **aangan_qualify** with is_existing_client_complaint = true and say its \`say\` line. Do not try to qualify them or book a consultation.

## Qualifying and booking
1. Once you know the area and the scope (or as soon as it's clearly a complaint), call **aangan_qualify** with everything collected so far.
2. Do what its response says:
   - \`offer_booking: true\` → call **aangan_get_slots**, read the options from its \`say\`, let the caller choose, then call **aangan_book_slot** with that \`slot_id\` and read back its \`say\` (the confirmation).
   - \`ask_next\` present → ask exactly that one question, then call **aangan_qualify** again with the answer.
   - otherwise → say its \`say\` line politely and close the call. Do not offer a booking.
3. If a tool fails or returns \`booking_pending\`, say: "${LINES.fallback}" and close warmly.
Only offer a consultation when aangan_qualify returned \`offer_booking: true\`.

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
    "Agent: created/updated by `npm run vaani:config -- --apply`. Tools: Tools & Actions → New Action → Create Custom Tool, one per entry below, then attach to the agent. Webhook: Developers → Webhooks → Agent Webhook, Secret = VAANI_WEBHOOK_SECRET (signs X-Vaani-Signature over '{timestamp}.{body}').",
  name: "Aangan Studio – Front Desk",
  greeting,
  languages: ["en-IN", "hi-IN", "mr-IN"],
  language_policy: "Start in English; switch to the caller's language (Hindi/Marathi) if they use it. Use only languages Vaani supports.",
  system_prompt_file: "vaani/system-prompt.md",
  tools: [
    {
      name: "aangan_qualify",
      description: "Check the enquiry against the studio's rules. Call once area and scope are known, again after an ask_next answer, or immediately for an existing-client complaint.",
      method: "POST",
      url: `${base}/api/vaani/qualify`,
      timeout_ms: 4000,
      headers: { [TOOL_SECRET_HEADER]: "<VAANI_WEBHOOK_SECRET — paste from clipboard, never commit>" },
      parameters: toolSchema(LiveArgs),
    },
    {
      name: "aangan_get_slots",
      description: "Get three open consultation times (next 7 days, studio hours). Only after qualify returned offer_booking: true.",
      method: "POST",
      url: `${base}/api/vaani/slots`,
      timeout_ms: 4000,
      headers: { [TOOL_SECRET_HEADER]: "<VAANI_WEBHOOK_SECRET — paste from clipboard, never commit>" },
      parameters: { type: "object", properties: {} },
    },
    {
      name: "aangan_book_slot",
      description: "Book the consultation the caller chose. Re-checks the time is still free and sends calendar invites.",
      method: "POST",
      url: `${base}/api/vaani/book`,
      timeout_ms: 4000,
      headers: { [TOOL_SECRET_HEADER]: "<VAANI_WEBHOOK_SECRET — paste from clipboard, never commit>" },
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
  tool_response_shape: "JSON; the agent should speak the `say` field (map $.say to a variable if the dashboard asks).",
  webhook: { type: "Agent Webhook", url: `${base}/api/vaani/call-ended`, secret: "VAANI_WEBHOOK_SECRET", events_used: ["call_started", "call_postprocessing"] },
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

// ---------------------------------------------------------------------------
// --apply: create or update the agent through the Vaani AI API
// ---------------------------------------------------------------------------
if (process.argv.includes("--apply")) {
  const key = process.env.VAANI_API_KEY;
  if (!key) throw new Error("VAANI_API_KEY is not set");
  const headers = { "X-API-Key": key, "Content-Type": "application/json" };
  const persona = {
    identity: {
      system_prompt: systemPrompt,
      greeting_message: { agent_message: greeting, agent_speech_delay: 1, interruptible: true, let_user_speak_first: false },
      personality: { tone: "warm", style: "professional" },
    },
    // English by default; detect Hindi/Marathi callers.
    senses_capabilities: { language: "en", auto_detect: true },
  };

  let agentId = process.env.VAANI_AGENT_ID;
  if (!agentId) {
    const res = await fetch(`${VAANI_API}/api/create-agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agent_display_name: config.name, config: { persona } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.agent_id) throw new Error(`create-agent → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    agentId = body.agent_id as string;
    // Remember it so the next run updates instead of creating a duplicate.
    const envPath = ".env.local";
    const lines = readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith("VAANI_AGENT_ID="));
    lines.push(`VAANI_AGENT_ID=${agentId}`);
    writeFileSync(envPath, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
    console.log(`✓ created agent "${config.name}" → ${agentId} (saved as VAANI_AGENT_ID in .env.local)`);
  } else {
    const res = await fetch(`${VAANI_API}/api/agent/${agentId}/persona`, { method: "PATCH", headers, body: JSON.stringify(persona) });
    const text = await res.text();
    if (!res.ok) throw new Error(`update persona → ${res.status}: ${text.slice(0, 300)}`);
    console.log(`✓ updated persona of agent ${agentId}`);
  }
}
