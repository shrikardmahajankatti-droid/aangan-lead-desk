-- vaanivoice.ai sends the caller's number only on `call_started`; `call_postprocessing`
-- (transcript, summary, recording) arrives later without it. Keep the start event per call.
create table vaani_call_starts (
  call_id       text primary key,
  phone_number  text,
  status        text,
  received_at   timestamptz not null default now(),
  payload       jsonb
);
