# Aangan Studio – Qualification Logic & Scoring Rubric

*Derived from `qualified.md` (Nikhil's rubric), `services.md` and `pricing.md`. Calibrated on the September 2026 phone transcripts T01–T20.*
*Used by: the Vaani Labs voice agent (live call) and Gemini Flash (post-call analysis).*

---

## How this works, in one line

**Step 0** decides what kind of record it is. **Step 1** is Nikhil's pass/fail gate, which decides *whether* a lead reaches a designer. **Step 2** scores qualified leads 0–10, which decides *how fast* the designer calls back. **The score never blocks a qualified lead.** Every lead that passes Step 1 is forwarded.

---

## Step 0 – Record type (check first)

| Record type | How to spot it | Route | Score? |
|---|---|---|---|
| `escalation` | Existing client with a complaint about an ongoing project (e.g. "my designer hasn't replied") | Urgent email to Nikhil. No HubSpot, no designer handoff. | No |
| `missed_call` | No conversation (missed, or no voicemail) | Call-back list on the dashboard | No |
| `dropped_call` | Call cut off before any details. If the same number calls back within 10 min, merge into one record. | Merge or call-back list | No |
| `out_of_scope_channel` | WhatsApp or web form (this build is phone only) | Count on dashboard only | No |
| `lead` | A new project enquiry | Go to Step 1 | Yes |

---

## Step 1 – The five gates (Nikhil's rules)

Mark each gate **Pass**, **Fail** or **Unclear**.

### Gate 1 – Real project in our scope
*Design + execution, of a type we do.*

| Pass | Fail |
|---|---|
| Full home, partial home (2+ rooms), single room with full execution, office/clinic/studio up to ~3,000 sq ft | Advice/ideas only ("just suggestions", "come and advise", "I'll do execution myself") |
| Rented flat with no structural changes | Restaurant, hotel, retail, gym (out of services) |
| Caller unsure of style/materials (not a fail) | Structural/architecture work, standalone furniture sourcing, Vastu-only, decor/styling only |
| | Commercial space far below a workable scope (see Ambiguity A) |

**Ask if unclear:** "Are you looking for design and full execution, or mainly design advice?"

### Gate 2 – In our service area
**Pass:** Pune city or PCMC, including Kothrud, Baner, Aundh, Wakad, Koregaon Park, Kalyani Nagar, Viman Nagar, Hadapsar, Magarpatta, NIBM, Kondhwa, Undri, Shivane, Warje, Erandwane, Deccan, Kharadi, Pimpri, Chinchwad, Pimple Saudagar, Pimple Nilakh, Ravet, Hinjewadi and adjoining areas.
**Fail:** Talegaon, Lonavala, Nashik, Mumbai, any other city.

**Ask if unclear:** "Which area in Pune is the property in?"

### Gate 3 – Realistic timeline
Design takes 3–4 weeks and execution 8–16 weeks. We can't begin a project that must be ready in under 6 weeks.

| Pass | Fail | Unclear |
|---|---|---|
| Deadline leaves ≥ ~11 weeks for design + execution | A hard deadline under ~6 weeks away (e.g. "before Diwali in 3 weeks", "guests in 3 weeks") | A deadline is mentioned but it isn't clear whether it's a completion date |
| No deadline stated and the site is accessible (treat as Pass) | | Site won't be accessible for execution within ~10 weeks (see Ambiguity B) |

**Ask if unclear:** "When would you need the project complete?"

### Gate 4 – Budget broadly aligned (only if volunteered)
**Never ask about budget. Never quote.** Only judge a number the caller offers.

Work out the **minimum indicative cost** from `pricing.md`. This is internal only and never said to the caller.
- Residential with a known designed area: area × ₹1,800
- Residential by room: rooms in scope × ₹3.5 lakh (the single-room minimum)
- Commercial: area × ₹1,200
- Use the **lower** estimate if both apply.

| Result | Rule |
|---|---|
| **Pass** | No budget mentioned, or budget ≥ 60% of the minimum indicative cost |
| **Pass + note** | Budget between 60% and 100% of the minimum. Note in the handoff: "budget may be tight". |
| **Fail** | Budget < 60% of the minimum (e.g. ₹1–1.5 lakh for kitchen + bedroom, minimum ≈ ₹7 lakh) |

### Gate 5 – Decision-maker on the call (or represented)
| Pass | Unclear | Fail |
|---|---|---|
| Owner, or confirms they're authorised ("my husband said go ahead"). Tenant for their own flat. Founder for an office. | Calling for someone else who will attend and decide, or never said | "Just doing initial research for my in-laws", with no authorisation and no plan for the decision-maker to engage |

### Decision rules

| Situation | Verdict | What happens |
|---|---|---|
| All five Pass | **Qualified** | Forward to designer + HubSpot |
| Gate 4 or 5 Unclear, the rest Pass | **Qualified** | Forward, with the uncertainty noted in the handoff. Don't push on the call. |
| Gate 1, 2 or 3 Unclear | **Ask one direct question** on the call. If it's still unclear after the call → `needs_info` | Call-back list, not designer |
| Any one gate Fails | **Not qualified** | Close gracefully. Don't forward. |
| Fails only because of timing or "just exploring" | **Not qualified – Nurture** | Tag "re-engage if timeline/scope changes" |
| Two or more Fail | **Not qualified** | Use the standard decline line (below) |

### What does NOT disqualify (never mark Fail for these)
- Not knowing exactly what they want
- Calling outside office hours
- Asking for pricing. Deflect, don't disqualify.
- Unsure about materials, style or layout
- A single-room project with full execution
- A rented apartment with no structural changes

---

## Step 2 – Lead score (qualified leads only, 0–10)

| Dimension | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **A. Project value** (indicative, internal) | – | ≤ ₹8 L | ₹8–15 L | ₹15–30 L | > ₹30 L |
| **B. Readiness** | Vague / "someday" | Starts in 1–4 months, or not stated | Site ready (or within ~6 weeks) and wants to start design now | – | – |
| **C. Commitment** (+1 each) | – | Agreed to / asked for a consultation or site visit | Decision-maker(s) confirmed or will attend | – | – |
| **D. Source** | Unknown / cold | Referral from a past client, Nikhil's contact or a builder partner | – | – | – |
| **E. Completeness** | Any of location, scope, size, timeline missing | All four captured | – | – | – |

Maximum: A 4 + B 2 + C 2 + D 1 + E 1 = **10**.

**Estimating value when the area isn't given:** use defaults of 1BHK ≈ 550, 2BHK ≈ 900, 3BHK ≈ 1,200, 4BHK ≈ 2,000 sq ft carpet, at ₹1,800/sq ft. For partial scope, use rooms × ₹3.5 L.

### Score → priority (what the designer sees)

| Score | Label | Designer action |
|---|---|---|
| 8–10 | 🔥 **Hot** | Call back within 1 hour |
| 6–7 | **Warm** | Call back the same working day |
| 0–5 | **Standard** | Call back within 24 hours |

**Urgent override:** if the caller is frustrated by an earlier missed follow-up (e.g. "I called Monday, no one got back"), set `urgent = true`. The email subject then starts "URGENT – response delayed" and the callback is within 1 hour by a senior designer, **whatever the score**.

---

## On the live call (Vaani agent behaviour)

**Collect**, naturally and not as an interrogation: name · area/location · property type + size · scope (rooms) · timeline · decision-maker. Don't ask about budget.

- **Pricing question:** *"Pricing depends on the site, the materials you choose, and the scope. Your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."* Never give any number, range or "starts at".
- **Budget volunteered and clearly too low (Gate 4 Fail):** *"Thank you for sharing that. For that scope with full execution, the budget would be well below what a project like this costs with us. I wouldn't want to bring you in if the numbers don't align."*
- **Outside service area:** *"We only work in Pune and PCMC at the moment. We don't have our contractor network outside, so we wouldn't be able to do it well."*
- **Advice only:** *"We're a full-service studio, so our projects include design and execution together. If you plan a full redesign later, we'd love to help."*
- **Timeline too short:** say so honestly, and offer a later start if the caller is open to it.
- **Two or more fails:** *"This sounds like it may not be the right fit for us right now, but feel free to reach out if your timeline or scope changes."*
- **Qualified:** offer three consultation slots (Google Calendar) and book on the call.

---

## Output (Gemini returns this per call)

```json
{
  "record_type": "lead | escalation | missed_call | dropped_call | out_of_scope_channel",
  "gates": {
    "real_project":     {"result": "pass | fail | unclear", "evidence": "short quote"},
    "service_area":     {"result": "...", "evidence": "..."},
    "timeline":         {"result": "...", "evidence": "..."},
    "budget":           {"result": "pass | pass_tight | fail", "evidence": "..."},
    "decision_maker":   {"result": "...", "evidence": "..."}
  },
  "verdict": "qualified | not_qualified | nurture | needs_info",
  "score": 0,
  "score_breakdown": {"value": 0, "readiness": 0, "commitment": 0, "source": 0, "completeness": 0},
  "score_label": "Hot | Warm | Standard",
  "urgent": false,
  "handoff_notes": ["uncertainties to flag, e.g. 'decision-maker not confirmed'"]
}
```

Each `evidence` must be a short quote or fact from the transcript. If there's no evidence, the gate is `unclear`, never `pass`.

---

## Calibration set – September 2026 phone calls (expected results)

Use these as test cases. The build should reproduce them.

| ID | Caller / project | Gates | Verdict | Score (A+B+C+D+E) | Label |
|---|---|---|---|---|---|
| T01 | Priya – 3BHK 1,400 sq ft, Kothrud, full redo, by March, past-client referral | All pass | Qualified | 3+2+2+1+1 = **9** | 🔥 Hot |
| T02 | 2BHK 950 sq ft, Wakad, full, design from Oct; asked price twice | Pass (DM unclear → note) | Qualified | 3+2+1+0+1 = **7** | Warm |
| T03 | Suresh – home office, **Nashik** | G2 fail | Not qualified | – | – |
| T04 | Living room **ideas only** | G1 fail | Nurture | – | – |
| T05 | Aarti – 4BHK 2,400 sq ft, Koregaon Park, Feb, Nikhil's friend's referral | Pass (DM unclear → note) | Qualified | 4+2+1+1+1 = **9** | 🔥 Hot |
| T06 | Startup office 800 sq ft, Baner, bare shell, Dec, founder | All pass | Qualified | 2+2+2+0+1 = **7** | Warm |
| T07 | Living + kitchen **before Diwali (3 weeks)** | G3 fail | Nurture (open to Nov start) | – | – |
| T08 | Missed call, 10:47pm | – | `missed_call` → call-back list | – | – |
| T09 | Sheetal – **existing client complaint** | – | `escalation` → Nikhil | – | – |
| T10 | 1BHK Kharadi, kitchen + bedroom, **budget ₹1–1.5 L** | G4 fail | Not qualified | – | – |
| T11 | Rented 2BHK Baner, 3 rooms, no structural, landlord OK | All pass | Qualified | 2+1+2+0+0 = **5** | Standard |
| T12 | Anand – villa 5,500 sq ft, Kalyani Nagar, new, March | Pass (DM unclear → note) | Qualified | 4+2+1+0+1 = **8** | 🔥 Hot |
| T13 | 3BHK Aundh, kitchen + wardrobes + living; asked price | Pass (DM unclear) | Qualified | 2+1+1+0+0 = **4** | Standard |
| T14 | Son for parents – 3BHK Hadapsar, new possession; parents will attend | G5 unclear → note | Qualified | 3+1+0+0+0 = **4** | Standard |
| T15 | Smita – 2BHK 875 sq ft, Undri, possession in 6 weeks, husband said go ahead | All pass | Qualified | 3+2+2+0+1 = **8** | 🔥 Hot |
| T16 | Girish – 3BHK Viman Nagar, **no follow-up since Monday, frustrated** | Pass (DM unclear) | Qualified + **urgent** | 3+1+1+0+0 = **5** | Standard → **URGENT override** |
| T17 | Ritu – 3BHK 1,050 sq ft, Pimple Saudagar (dropped + callback, merged), by March | Pass (DM unclear) | Qualified | 3+2+1+0+1 = **7** | Warm |
| T18 | Coworking pod **180 sq ft** | G1 fail (Ambiguity A) | Not qualified | – | – |
| T19 | **Restaurant**, Koregaon Park | G1 fail | Not qualified | – | – |
| T20 | Pooja – 2BHK 900 sq ft, Magarpatta, Jan execution start, both owners attending | All pass | Qualified | 3+1+2+0+1 = **7** | Warm |

**Totals:** 12 qualified (4 Hot · 4 Warm · 4 Standard, 1 urgent) · 6 not qualified (2 nurture) · 1 missed call · 1 escalation.

---

## Ambiguities for Nikhil to confirm

- **A. Minimum commercial size.** `services.md` gives a maximum (~3,000 sq ft) but no minimum. The front desk told T18 "500 sq ft or more". *Proposed:* commercial under 500 sq ft = Gate 1 fail.
- **B. "Site available within 8–10 weeks".** If the site is ready but the client *prefers* a later start (T20: January), we treat that as Pass. We only flag when the site itself won't be accessible within ~10 weeks. *Confirm.*
- **C. Kharadi** isn't in the `services.md` area list but is within Pune city. We treat it as in-area. *Confirm.*
- **D. Budget "clearly below" threshold.** We use < 60% of the minimum indicative cost. *Confirm or adjust.*
