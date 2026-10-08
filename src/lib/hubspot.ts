import "server-only";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/contacts";
import { AssociationSpecAssociationCategoryEnum as Cat } from "@hubspot/api-client/lib/codegen/crm/deals";
import { env } from "./env";
import { minIndicativeLakh, type ValueInputs } from "./scoring";

// HUBSPOT_DEFINED association type ids (CRM associations v4)
const DEAL_TO_CONTACT = 3;
const NOTE_TO_DEAL = 214;
const NOTE_TO_CONTACT = 202;
export const CALL_ID_PROPERTY = "aangan_call_id";
export const STAGE_LABELS = { booked: "Consultation booked", new: "New qualified lead" } as const;

let client: Client | null = null;
function hs(): Client {
  client ??= new Client({ accessToken: env("hubspot").HUBSPOT_ACCESS_TOKEN, numberOfApiCallRetries: 3 });
  return client;
}

export type HubspotCall = {
  id: string;
  record_type: string | null;
  caller_number: string | null;
  summary: string | null;
  score: number | null;
  score_label: string | null;
  fields: Record<string, unknown> | null;
};

/** Pure: what we'd send. Logged as-is in dry run. */
export function hubspotPayload(c: HubspotCall, booked: boolean, baseUrl: string) {
  const f = (c.fields ?? {}) as Record<string, any>;
  const name: string | null = f.caller_name ?? null;
  const [first, ...rest] = (name ?? "").trim().split(/\s+/);
  const phone: string | null = f.phone ?? c.caller_number ?? null;
  const location: string | null = f.location ?? null;
  const property: string | null = f.property_type ?? null;
  const lakh = minIndicativeLakh({
    segment: f.segment ?? null,
    sq_ft: f.sq_ft ?? null,
    bhk: f.bhk ?? null,
    scope_extent: f.scope_extent ?? "unknown",
    rooms_in_scope: f.rooms_in_scope ?? null,
    budget_max_lakh: null,
  } satisfies ValueInputs);
  const link = `${baseUrl.replace(/\/$/, "")}/calls/${c.id}`;

  return {
    contact: {
      search: phone ? { phone } : { [CALL_ID_PROPERTY]: c.id },
      properties: {
        firstname: name ? first : `Unknown caller${location ? ` – ${location}` : ""}`,
        ...(name && rest.length ? { lastname: rest.join(" ") } : {}),
        ...(phone ? { phone } : {}),
        [CALL_ID_PROPERTY]: c.id,
      },
    },
    deal: {
      properties: {
        dealname: [name ?? "Unknown caller", [property, location].filter(Boolean).join(" ")].filter(Boolean).join(" – "),
        stage_label: booked ? STAGE_LABELS.booked : STAGE_LABELS.new,
        // Indicative value (internal estimate from pricing.md), not a quote
        ...(lakh ? { amount: String(Math.round(lakh * 100_000)) } : {}),
      },
    },
    note: {
      body: `<p>${escapeHtml(c.summary ?? "Qualified enquiry from the Aangan Lead Desk.")}</p>` +
        (c.score !== null ? `<p>Lead score ${c.score}/10 (${c.score_label}).</p>` : "") +
        `<p><a href="${link}">Transcript, gates and recording</a></p>`,
    },
  };
}

let stageCache: { pipeline: string; booked: string; new: string } | null = null;

/** Deal stage ids by label, so no stage ids need to live in env. */
export async function resolveStages() {
  if (stageCache) return stageCache;
  const pipelines = await hs().crm.pipelines.pipelinesApi.getAll("deals");
  const pipeline = pipelines.results.find((p) => p.id === "default") ?? pipelines.results[0];
  if (!pipeline) throw new Error("HubSpot: no deal pipeline found");
  const find = (label: string) => pipeline.stages.find((s) => s.label.trim().toLowerCase() === label.toLowerCase())?.id;
  const booked = find(STAGE_LABELS.booked);
  const fresh = find(STAGE_LABELS.new);
  const missing = [!booked && STAGE_LABELS.booked, !fresh && STAGE_LABELS.new].filter(Boolean);
  if (missing.length)
    throw new Error(`HubSpot: add deal stage(s) ${missing.map((m) => `"${m}"`).join(", ")} to pipeline "${pipeline.label}"`);
  stageCache = { pipeline: pipeline.id, booked: booked!, new: fresh! };
  return stageCache;
}

/** Find the contact by phone, else by aangan_call_id; create if missing. Returns the contact id. */
export async function upsertContact(p: ReturnType<typeof hubspotPayload>["contact"]): Promise<string> {
  const [prop, value] = Object.entries(p.search)[0];
  const found = await hs().crm.contacts.searchApi.doSearch({
    filterGroups: [{ filters: [{ propertyName: prop, operator: FilterOperatorEnum.Eq, value: String(value) }] }],
    properties: ["firstname", "phone", CALL_ID_PROPERTY],
    limit: 1,
  });
  if (found.results[0]) return found.results[0].id;
  // Phone search missed: also try the call id before creating (covers retries after a partial failure).
  if (prop !== CALL_ID_PROPERTY) {
    const byId = await hs().crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters: [{ propertyName: CALL_ID_PROPERTY, operator: FilterOperatorEnum.Eq, value: p.properties[CALL_ID_PROPERTY] }] }],
      limit: 1,
    });
    if (byId.results[0]) return byId.results[0].id;
  }
  const created = await hs().crm.contacts.basicApi.create({ properties: p.properties as Record<string, string>, associations: [] });
  return created.id;
}

export async function createDealWithNote(p: ReturnType<typeof hubspotPayload>, contactId: string): Promise<string> {
  const stages = await resolveStages();
  const { stage_label, ...props } = p.deal.properties;
  const deal = await hs().crm.deals.basicApi.create({
    properties: {
      ...props,
      pipeline: stages.pipeline,
      dealstage: stage_label === STAGE_LABELS.booked ? stages.booked : stages.new,
    },
    associations: [{ to: { id: contactId }, types: [{ associationCategory: Cat.HubspotDefined, associationTypeId: DEAL_TO_CONTACT }] }],
  });
  await hs().crm.objects.notes.basicApi.create({
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: p.note.body },
    associations: [
      { to: { id: deal.id }, types: [{ associationCategory: Cat.HubspotDefined, associationTypeId: NOTE_TO_DEAL }] },
      { to: { id: contactId }, types: [{ associationCategory: Cat.HubspotDefined, associationTypeId: NOTE_TO_CONTACT }] },
    ],
  });
  return deal.id;
}

/** One-time setup: the custom contact property used for dedupe. Needs crm.schemas.contacts.write. */
export async function ensureCallIdProperty(): Promise<"exists" | "created"> {
  try {
    await hs().crm.properties.coreApi.getByName("contacts", CALL_ID_PROPERTY);
    return "exists";
  } catch (e) {
    if ((e as { code?: number }).code !== 404) throw e;
  }
  await hs().crm.properties.coreApi.create("contacts", {
    name: CALL_ID_PROPERTY,
    label: "Aangan call ID",
    groupName: "contactinformation",
    type: "string" as never,
    fieldType: "text" as never,
    description: "Lead Desk call record id (dedupe key for callers without a phone number)",
  });
  return "created";
}

function escapeHtml(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
