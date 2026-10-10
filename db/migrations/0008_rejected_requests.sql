-- Rejected Vaani requests (bad/missing signature or tool secret). Vercel's free plan keeps logs
-- ~1 hour, so keep the diagnosis here. Never stores secrets or bodies: header names, lengths
-- and which signing scheme would have matched (booleans).
create table rejected_requests (
  id           bigint generated always as identity primary key,
  route        text not null,
  reason       text not null,
  event        text,
  header_names text[] not null default '{}',
  details      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index rejected_requests_created_idx on rejected_requests (created_at desc);
