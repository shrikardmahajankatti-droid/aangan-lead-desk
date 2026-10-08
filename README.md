# Aangan Lead Desk

An AI phone desk for **Aangan Studio** (interior design, Pune). A Vaani Labs voice agent answers every call 24×7. It qualifies the caller against the studio's own rulebook and books a consultation on Google Calendar. After the call, the record lands in Neon and on this dashboard. Qualified leads go to the designer by email (Resend) and into HubSpot as a contact plus deal.

The same pipeline accepts a PDF of past transcripts (seed data), so everything can be tested without live calls.

```
Caller ─► Vaani agent ─► /api/vaani/qualify ─► (qualified) /slots ─► /book ─► Google Calendar
                               │ call ends
                               ▼
        /api/vaani/call-ended ─┤◄── /upload (seed PDF), /api/process, /api/dev/simulate-call
                               ▼
  processCall: dedupe → record type → Gemini Flash → Neon → route → deliver
     qualified → designer email + HubSpot · escalation → Nikhil (never HubSpot)
     missed / dropped / needs_info → call-back list · not qualified / nurture → dashboard with reason
```

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind + zod on Vercel (`sin1`). Neon Postgres (Singapore). Gemini Flash (`@google/genai`). Google Calendar API. Resend. HubSpot (`@hubspot/api-client`). Vaani Labs.

## The rulebook

`/context` holds the rules. Nothing about qualification is hard-coded beyond what these files say:

| File | Used for |
|---|---|
| `qualification_logic.md` | Step 0 record type, the five gates, decision rules, score rubric, the agent's lines |
| `qualified.md` | Nikhil's own rubric (reference) |
| `services.md` | What the agent may say the studio does |
| `pricing.md` | **Designer-only** indicative range, plus the agent's single pricing deflection line |

Gemini makes the judgement calls: gates 1, 2, 3 and 5, readiness, commitment and source. **Code** does everything mechanical: project value, completeness, the Gate 4 budget check against `pricing.md`, the verdict decision rules, the total score and the label (`src/lib/scoring.ts`, `src/lib/analysis.ts`). That makes scores repeatable and testable. The calibration table is stripped from the prompt, so seed results test the rules rather than look up the answer key.

Clarifications applied, as agreed with the studio:
- **Commercial size:** under 500 sq ft fails Gate 1.
- **Later start:** a client who prefers a later start passes Gate 3.
- **Service area:** Kharadi is in area.
- **Budget:** under 60% of the minimum indicative cost fails Gate 4.
- **Defaults:** no deadline and no budget count as Pass.
- **Move-in dates:** treated as soft.
- **Gate 5:** "my flat" alone doesn't confirm the decision-maker.

## Setup

```bash
npm install
cp .env.example .env.local      # fill in (see below)
npm run db:migrate              # applies db/migrations/*.sql to Neon
npm run check:gemini            # confirms GEMINI_MODEL works on your key (falls back to gemini-3.7-flash)
npm run dev
```

Then open http://localhost:3000/upload and upload `data/Aangan_Sep 2026_Enquiries.pdf`. Or run `npm run seed` from the terminal.

### Environment variables

All values are server-only (no `NEXT_PUBLIC_`). Set the same names in Vercel → Project → Settings → Environment Variables. Blank optional values fall back to the defaults in `src/lib/env.ts`.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (`-pooler` host). Used by the app. |
| `DATABASE_URL_UNPOOLED` | Neon direct connection. Used only by `db:migrate`, which falls back to the pooled URL. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Default `gemini-3.8-flash`. Fallback `gemini-3.7-flash`. |
| `GEMINI_INPUT_COST_PER_1M`, `GEMINI_OUTPUT_COST_PER_1M` | **₹ per 1M tokens**, for the cost tile (output includes thinking tokens). |
| `VAANI_API_KEY` | `vv_live_…` key from vaanilabs.in/api-keys (`npm run check:vaani` tests it). |
| `VAANI_WEBHOOK_SECRET` | `vv_whk_…` signing secret, shown once when the webhook is registered. Verifies **every** Vaani request. |
| `VAANI_PHONE_NUMBER`, `VAANI_COST_PER_MIN` | Studio number; ₹ per minute for the cost tile. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | See Google Calendar below. |
| `CONSULT_DURATION_MIN`, `CONSULT_HOURS` | Default `60` and `10:00-19:00` (Asia/Kolkata). |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_FROM` defaults to `onboarding@resend.dev`. |
| `DESIGNER_NAME`, `DESIGNER_EMAIL`, `ESCALATION_EMAIL` | Escalations go to Nikhil / the studio head. |
| `HUBSPOT_ACCESS_TOKEN` | Private App token. |
| `APP_BASE_URL` | e.g. `https://aangan-lead-desk.vercel.app`. Used in email, calendar and HubSpot links. |
| `DRY_RUN` | **Default `true`.** Only the literal `false` sends emails, pushes to HubSpot and books events. In dry run, every payload is logged in the `actions` table and shown on the call page. |

### Resend

> ⚠️ **Resend's test sender (`onboarding@resend.dev`) only delivers to the email address that owns the Resend account.** Any other recipient gets a 403 until you verify a domain (Resend → Domains) and set `EMAIL_FROM` to an address on it. For testing, set `DESIGNER_EMAIL` and `ESCALATION_EMAIL` to the account owner's address.

### HubSpot

1. Settings → Integrations → **Private Apps** → Create. HubSpot is phasing out new Private Apps ("legacy apps"): existing accounts can't create them after **26 Oct 2026**. After that, use a Service Key with the same scopes.
2. Scopes: **`crm.objects.contacts.read`**, **`crm.objects.contacts.write`**, **`crm.objects.deals.read`**, **`crm.objects.deals.write`**. Add `crm.schemas.contacts.write` if you want the setup script to create the custom property.
3. In Settings → Objects → Deals → Pipelines, add two stages to the deals pipeline, named exactly **`Consultation booked`** and **`New qualified lead`**. Stage IDs are looked up by these labels.
4. `npm run hubspot:setup` checks the token, creates the `aangan_call_id` contact property if missing, and confirms both stages.

Each qualified lead does the following:
- **Contact:** found by phone, then by `aangan_call_id`, or created if neither matches.
- **Deal:** `{caller} – {property} {location}`. The stage is "Consultation booked" if an event exists, otherwise "New qualified lead". The amount is the internal indicative value.
- **Note:** the summary plus a dashboard link.

### Google Calendar (OAuth, not a service account)

A service account can't invite attendees without Workspace domain-wide delegation, so the app uses the **studio's own Google account** with a refresh token.

1. Google Cloud Console → enable **Google Calendar API**.
2. OAuth consent screen: add the two scopes `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.freebusy`. **Publish the app (In production).** Apps left in "Testing" get refresh tokens that expire after 7 days.
3. Credentials → Create OAuth client ID → type **Desktop app**. Put the ID and secret in `.env.local`.
4. `npm run google:auth`. Sign in as the studio account. The refresh token is written to `.env.local` and never printed.
5. Set `GOOGLE_CALENDAR_ID` (the consultations calendar, or `primary`). `npm run calendar:check` lists the next 3 slots.

Booking uses:
- `freebusy.query` for 3 slots over the next 7 days, **Monday–Friday only**, within `CONSULT_HOURS` (one per day, 2 h notice)
- a re-check before booking
- `events.insert` with the designer and caller as attendees and `sendUpdates=all`

At most one event per call.

### Vaani Labs agent

Vaani's public API ([spec](https://www.vaanilabs.in/openapi/v1/vaanivoice.yaml)) covers sessions, rooms and keys. **It has no endpoints to create agents/flows, register tools or webhooks.** Those are configured in the Vaani dashboard (Flow Builder). So:

```bash
npm run vaani:config     # writes vaani/system-prompt.md + vaani/agent-config.json
```

Then enter that config in the dashboard:
- the greeting
- English/Hindi/Marathi (whichever Vaani supports)
- the system prompt
- the three tools (`qualify`, `get_slots`, `book_slot`), with their URLs and JSON schemas
- the post-call webhook `${APP_BASE_URL}/api/vaani/call-ended` for `call.completed` and `call.failed`

The script refuses to write a prompt that contains any pricing figure: the agent only knows the deflection line.

All Vaani-specific parsing lives in `src/lib/vaani/adapter.ts`:
- **Documented, and implemented exactly:**
  - the `X-VaaniVoice-Signature: sha256=<hex>` HMAC check
  - the event envelope
  - dedupe on the event id
- **Undocumented** (the `call.completed` data fields and the tool request/response format): mapped defensively. Adjust only that file once Vaani shares the real shapes.

`POST /api/dev/simulate-call` (dev only) runs a sample call through the same path.

**Mid-call tools respond within about 3 s.** If Gemini or Calendar is slow or unavailable, the agent says "Let me have a designer call you to confirm a time" and the call is flagged booking-pending. Every tool call is logged in `live_tool_calls` (latency, fallbacks, Gemini spend).

### Deploying to Vercel

The repo is connected to the Vercel project, so pushing to `main` deploys it. Functions run in `sin1` (`vercel.json`), next to Neon in `aws-ap-southeast-1`. Add every env var above to Production (and Preview if used), with `APP_BASE_URL` set to the production URL. Run `npm run db:migrate` locally against Neon before deploying schema changes.

## Using it

- **`/`**: dashboard.
  - **Tiles:** calls handled, answered within 5 min, after hours, qualified % (Hot / Warm / Standard), bookings, emails, HubSpot, escalations, call-back list, and running cost (Vaani minutes × rate + Gemini tokens × rate, total and per qualified lead).
  - **Call-back list.**
  - **Calls table:** search and filters. Urgent leads and escalations are pinned.
- **`/calls/[id]`**: one call.
  - **Content:** transcript, recording, the five gates with evidence, score breakdown, fields, opening questions, an email preview, the designer-only pricing guide, Calendar and HubSpot status, and the audit log.
  - **Buttons:** **Re-run Gemini**, **Resend email**, **Retry HubSpot**, **Override verdict**. Overriding to Qualified sends the email and pushes to HubSpot, once.
- **`/upload`**: seed PDF. It shows "Found 40: 20 phone, 10 WhatsApp, 10 web form", then processes phone calls one per request. It's safe to re-upload.
- **`/setup`**: which integrations are configured (never their values) and table sizes.

### Guardrails, and where they're enforced

| Guardrail | Where |
|---|---|
| The agent never states a price | System prompt has only the deflection line and no figures (`vaani:config` checks this). The qualify/slots/book responses contain no prices. |
| Pricing only in the designer email and dashboard | `indicative_range` is computed in code and shown only there. |
| Escalations never reach HubSpot or a designer | `deliver.ts` sends escalations only to `ESCALATION_EMAIL`. The HubSpot path requires `record_type = lead` and `verdict = qualified`. |
| Non-qualified calls never deleted; reason visible | No delete paths. Gates, evidence and reasons appear on the table and the call page. |
| Nothing emailed, pushed or booked twice | `actions.ts`: idempotency key plus a partial unique index. Success is final; failures can be retried. The webhook is deduped on its event id, and calls on (source, id, content hash). |
| Every Vaani request verified | `verifiedBody()` on every `/api/vaani/*` route: HMAC over the raw body, constant-time compare. |
| Keys never in code, logs, the browser or GitHub | Server-only env; `.env*` git-ignored; setup scripts never print secrets. |
| Starts in dry run | `DRY_RUN` defaults to true. |

## Tests

```bash
npm test               # splitter vs the real PDF, scoring vs calibration inputs, email, slots, Vaani adapter
npm run seed           # process the 20 seed phone calls
npm run show -- T01 T03 T08 T09 T14 T17   # print stored results as JSON
```

## Adding WhatsApp or the web form later

The pipeline is channel-agnostic once a source is mapped to a `CallRecord` (`src/lib/pipeline.ts`):
- **WhatsApp:** a WhatsApp Business API webhook route. Verify its signature, build the thread text as the transcript, and use the thread id as `external_id` and the sender as `caller_number`. Then `processCall`. Add `whatsapp` to `calls.source`, and pass the channel into the prompt so "caller"/"call" wording adapts.
- **Web form:** a `POST /api/forms` route (with a shared secret or captcha). Map the form fields into the transcript and the field hints, then `processCall`.
- In both cases, remove the channel from the `out_of_scope_channel` count. Booking would happen by email link rather than mid-call.

## Known limits and follow-ups

- **No login (by design for this build).** The dashboard and API are public on the Vercel URL and show caller transcripts. Add auth (e.g. Vercel Authentication or a basic-auth `proxy.ts`) before real callers use it.
- **Gemini free tier.** 5 requests/min and 20/day per model. That's fine for testing; a live desk needs the paid tier.
- **Vaani:** the payload shapes and tool-call format are unconfirmed (see above).
  - Webhooks are queued and delivered about once a minute.
  - Caller numbers arrive **masked**, which weakens HubSpot's match-by-phone and the 10-minute dropped-call merge. The merge relies on the number.
- **Secrets:** rotate any key that was shared in chat during setup.
