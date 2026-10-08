-- Every mid-call tool call (qualify / slots / book): audit trail, latency, and Gemini spend for the cost tile.
create table live_tool_calls (
  id            bigint generated always as identity primary key,
  vaani_call_id text,
  tool          text not null check (tool in ('qualify', 'get_slots', 'book_slot')),
  request       jsonb,
  response      jsonb,
  degraded      text,            -- set when we fell back (timeout / quota / calendar error)
  latency_ms    integer,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  cost_inr      numeric(12, 4) not null default 0,
  created_at    timestamptz not null default now()
);
create index live_tool_calls_call_idx on live_tool_calls (vaani_call_id, created_at);
