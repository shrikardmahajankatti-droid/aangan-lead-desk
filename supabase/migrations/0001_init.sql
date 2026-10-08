-- Aangan Lead Desk: initial schema
-- Tables: calls, leads, bookings, events (audit log), webhook_deliveries (Vaani dedupe)
-- RLS is enabled with no policies: only the server (service role key) can read/write.

create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- calls: one row per enquiry (a merged dropped+callback pair is one row)
-- ---------------------------------------------------------------------------
create table calls (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null check (source in ('vaani', 'seed', 'simulated')),
  external_id        text not null,              -- Vaani call id, or seed id (T01)
  content_hash       text not null,              -- sha256 of normalised transcript + header
  channel            text not null default 'phone'
                       check (channel in ('phone', 'whatsapp', 'web_form')),
  record_type        text check (record_type in
                       ('lead', 'escalation', 'missed_call', 'dropped_call', 'out_of_scope_channel')),
  call_status        text not null check (call_status in ('completed', 'missed', 'dropped')),
  caller_phone       text,
  started_at         timestamptz,
  duration_sec       integer,
  answer_delay_sec   integer,                    -- ring-to-answer; null for seed/missed
  after_hours        boolean,                    -- outside 10:00-19:00 IST
  transcript         text,
  notes              text,                       -- "Note:" / "Status:" lines from source
  recording_url      text,
  legs               jsonb not null default '[]', -- merged call legs (dropped + callback)
  raw_payload        jsonb,                      -- original webhook/seed record

  analysis_status    text not null default 'pending'
                       check (analysis_status in ('pending', 'done', 'error', 'skipped')),
  analysis           jsonb,                      -- full validated Gemini output
  analysis_error     text,
  gemini_model       text,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0, -- includes thinking tokens
  gemini_cost_usd    numeric(12, 6) not null default 0,
  vaani_cost_inr     numeric(12, 2) not null default 0,

  callback_status    text check (callback_status in ('pending', 'done')),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (source, external_id, content_hash)
);
create index calls_started_at_idx on calls (started_at desc);
create index calls_record_type_idx on calls (record_type);
create index calls_caller_phone_idx on calls (caller_phone, started_at desc);
create trigger calls_updated_at before update on calls
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- leads: extracted fields + qualification for lead / escalation records
-- ---------------------------------------------------------------------------
create table leads (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null unique references calls (id) on delete restrict,

  caller_name        text,
  phone              text,
  property_type      text,
  location           text,
  sq_ft              numeric,
  scope              text,
  budget_band        text,
  timeline           text,
  decision_maker     text,
  within_services    boolean,
  in_service_area    boolean,

  gates              jsonb,                      -- 5 gates with result + evidence
  verdict            text check (verdict in ('qualified', 'not_qualified', 'nurture', 'needs_info')),
  score              integer check (score between 0 and 10),
  score_breakdown    jsonb,
  score_label        text check (score_label in ('Hot', 'Warm', 'Standard')),
  urgent             boolean not null default false,
  reasons            text[] not null default '{}',
  handoff_notes      text[] not null default '{}',
  already_known      text,
  opening_questions  text[] not null default '{}',
  asked_about_price  boolean not null default false,
  indicative_range   text,                       -- internal only, never sent to caller
  summary            text,

  -- Nikhil's human check. Effective verdict = coalesce(override_verdict, verdict).
  override_verdict   text check (override_verdict in ('qualified', 'not_qualified', 'nurture', 'needs_info')),
  override_note      text,
  override_at        timestamptz,

  email_status       text not null default 'not_applicable'
                       check (email_status in ('not_applicable', 'pending', 'dry_run', 'sent', 'failed')),
  hubspot_status     text not null default 'not_applicable'
                       check (hubspot_status in ('not_applicable', 'pending', 'dry_run', 'synced', 'failed')),
  booking_status     text not null default 'not_applicable'
                       check (booking_status in ('not_applicable', 'not_booked', 'dry_run', 'booked', 'failed')),
  email_id           text,
  hubspot_contact_id text,
  hubspot_deal_id    text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index leads_verdict_idx on leads (verdict);
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings: Google Calendar consultations
-- ---------------------------------------------------------------------------
create table bookings (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid references calls (id) on delete restrict,
  lead_id            uuid references leads (id) on delete restrict,
  vaani_call_id      text,                       -- set during the live call, before calls row exists
  calendar_event_id  text unique,
  html_link          text,
  slot_start         timestamptz not null,
  slot_end           timestamptz not null,
  caller_name        text,
  caller_email       text,
  status             text not null check (status in ('dry_run', 'booked', 'cancelled', 'failed')),
  created_at         timestamptz not null default now()
);
-- At most one live booking per live call
create unique index bookings_one_per_vaani_call
  on bookings (vaani_call_id) where status = 'booked' and vaani_call_id is not null;
create index bookings_call_idx on bookings (call_id);
create index bookings_lead_idx on bookings (lead_id);

-- ---------------------------------------------------------------------------
-- events: audit log of every email / HubSpot / Calendar / Gemini action.
-- idempotency_key + the partial unique index is the "never twice" guard:
-- an action claims its key with status 'in_progress'; a failure frees it.
-- ---------------------------------------------------------------------------
create table events (
  id                 bigint generated always as identity primary key,
  call_id            uuid references calls (id) on delete restrict,
  lead_id            uuid references leads (id) on delete restrict,
  kind               text not null check (kind in
                       ('email', 'hubspot', 'calendar', 'gemini', 'override', 'webhook', 'pipeline')),
  action             text not null,              -- e.g. designer_email, create_deal, insert_event
  status             text not null check (status in ('in_progress', 'success', 'dry_run', 'error', 'skipped')),
  idempotency_key    text,
  dry_run            boolean not null default false,
  request            jsonb,
  response           jsonb,
  error              text,
  created_at         timestamptz not null default now()
);
create unique index events_idempotency_live
  on events (idempotency_key)
  where idempotency_key is not null and status in ('in_progress', 'success');
create index events_call_idx on events (call_id, created_at desc);
create index events_lead_idx on events (lead_id);

-- ---------------------------------------------------------------------------
-- webhook_deliveries: Vaani retries reuse the event id; record each once
-- ---------------------------------------------------------------------------
create table webhook_deliveries (
  event_id           text primary key,
  event_type         text not null,
  received_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seed uploads: counts for the out_of_scope tile (WhatsApp / web form)
-- ---------------------------------------------------------------------------
create table seed_uploads (
  id                 uuid primary key default gen_random_uuid(),
  file_hash          text not null,
  total              integer not null,
  phone              integer not null,
  whatsapp           integer not null,
  web_form           integer not null,
  created_at         timestamptz not null default now()
);

alter table calls              enable row level security;
alter table leads              enable row level security;
alter table bookings           enable row level security;
alter table events             enable row level security;
alter table webhook_deliveries enable row level security;
alter table seed_uploads       enable row level security;
