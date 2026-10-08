-- Aangan Lead Desk: initial schema (Neon Postgres)
-- calls · analyses · bookings · actions · overrides · webhook_deliveries · seed_uploads

create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- calls: one row per enquiry (a merged dropped + callback pair is one row)
-- ---------------------------------------------------------------------------
create table calls (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null check (source in ('vaani', 'seed', 'simulated')),
  external_id        text not null,               -- Vaani call id, or seed id (T01)
  content_hash       text not null,               -- sha256 of normalised header + transcript
  caller_number      text,
  started_at         timestamptz,
  duration_s         integer,
  answer_delay_s     integer,                     -- ring-to-answer; null for seed / missed
  status             text not null check (status in ('completed', 'missed', 'dropped')),
  record_type        text check (record_type in
                       ('lead', 'escalation', 'missed_call', 'dropped_call', 'out_of_scope_channel')),
  transcript         text,
  notes              text,                        -- "Note:" / "Status:" lines from the source
  recording_url      text,
  legs               jsonb not null default '[]', -- merged call legs (dropped + callback)
  raw_payload        jsonb,
  after_hours        boolean,                     -- outside 10:00–19:00 IST

  analysis_status    text not null default 'pending'
                       check (analysis_status in ('pending', 'done', 'error', 'skipped')),
  analysis_error     text,
  callback_status    text check (callback_status in ('pending', 'done')),

  -- Separate, retryable delivery statuses. 'done' is final: never repeated.
  email_status       text not null default 'not_applicable'
                       check (email_status in ('not_applicable', 'pending', 'dry_run', 'done', 'failed')),
  hubspot_status     text not null default 'not_applicable'
                       check (hubspot_status in ('not_applicable', 'pending', 'dry_run', 'done', 'failed')),
  booking_status     text not null default 'not_applicable'
                       check (booking_status in ('not_applicable', 'pending', 'dry_run', 'done', 'failed')),
  hubspot_contact_id text,
  hubspot_deal_id    text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source, external_id, content_hash)
);
create index calls_started_at_idx    on calls (started_at desc);
create index calls_record_type_idx   on calls (record_type);
create index calls_caller_number_idx on calls (caller_number, started_at desc);
create trigger calls_updated_at before update on calls
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- analyses: Gemini output. Each re-run appends; the latest row is current.
-- ---------------------------------------------------------------------------
create table analyses (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null references calls (id) on delete restrict,
  model              text not null,
  gates              jsonb not null,
  verdict            text not null check (verdict in ('qualified', 'not_qualified', 'nurture', 'needs_info')),
  score              integer check (score between 0 and 10),
  score_breakdown    jsonb,
  score_label        text check (score_label in ('Hot', 'Warm', 'Standard')),
  urgent             boolean not null default false,
  fields             jsonb not null,              -- caller_name, phone, property_type, location, sq_ft, ...
  reasons            text[] not null default '{}',
  already_known      text,
  opening_questions  text[] not null default '{}',
  handoff_notes      text[] not null default '{}',
  asked_about_price  boolean not null default false,
  indicative_range   text,                        -- internal only, never spoken to a caller
  summary            text,
  raw_output         jsonb not null,              -- full validated JSON as returned
  tokens_in          integer not null default 0,
  tokens_out         integer not null default 0,  -- includes thinking tokens
  cost_inr           numeric(12, 4) not null default 0,
  created_at         timestamptz not null default now()
);
create index analyses_call_idx on analyses (call_id, created_at desc);

-- ---------------------------------------------------------------------------
-- bookings: Google Calendar consultations
-- ---------------------------------------------------------------------------
create table bookings (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid references calls (id) on delete restrict,
  vaani_call_id      text,                        -- set mid-call, before the calls row exists
  event_id           text unique,
  html_link          text,
  slot_start         timestamptz not null,
  slot_end           timestamptz not null,
  caller_name        text,
  caller_email       text,
  status             text not null check (status in ('dry_run', 'booked', 'cancelled', 'failed')),
  created_at         timestamptz not null default now()
);
create unique index bookings_one_per_vaani_call
  on bookings (vaani_call_id) where status = 'booked' and vaani_call_id is not null;
create index bookings_call_idx on bookings (call_id);

-- ---------------------------------------------------------------------------
-- actions: audit log of every email / HubSpot / Calendar action, and the
-- "never twice" guard: an action claims idempotency_key as 'in_progress';
-- an error frees it for retry; 'success' holds it forever.
-- ---------------------------------------------------------------------------
create table actions (
  id                 bigint generated always as identity primary key,
  call_id            uuid references calls (id) on delete restrict,
  type               text not null check (type in ('email', 'escalation', 'hubspot', 'calendar')),
  status             text not null check (status in ('in_progress', 'success', 'dry_run', 'error')),
  idempotency_key    text,
  external_id        text,                        -- Resend id, HubSpot deal id, Calendar event id
  payload            jsonb,
  error              text,
  created_at         timestamptz not null default now()
);
create unique index actions_idempotency_live
  on actions (idempotency_key)
  where idempotency_key is not null and status in ('in_progress', 'success');
create index actions_call_idx on actions (call_id, created_at desc);

-- ---------------------------------------------------------------------------
-- overrides: Nikhil's human check. Effective verdict = latest override, else latest analysis.
-- ---------------------------------------------------------------------------
create table overrides (
  id                 bigint generated always as identity primary key,
  call_id            uuid not null references calls (id) on delete restrict,
  old_verdict        text,
  new_verdict        text not null check (new_verdict in ('qualified', 'not_qualified', 'nurture', 'needs_info')),
  note               text,
  created_at         timestamptz not null default now()
);
create index overrides_call_idx on overrides (call_id, created_at desc);

-- ---------------------------------------------------------------------------
-- webhook_deliveries: Vaani retries reuse the event id; process each once
-- ---------------------------------------------------------------------------
create table webhook_deliveries (
  event_id           text primary key,
  event_type         text not null,
  received_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- seed_uploads: channel counts for the out_of_scope_channel tile
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
