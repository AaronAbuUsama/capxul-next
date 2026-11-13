-- What Core keeps about every call, in the world's `app` schema: its declared events and its server spans, each
-- under the trace id the caller sent. The runner reads both back after a scenario. Applied when a world is created.
create schema if not exists app;

-- A declared event, written in the same transaction as the change it reports. `payload` is what it carries.
create table if not exists app.events (
  id bigint generated always as identity primary key,
  trace_id text not null,
  operation text not null,
  event text not null,
  payload jsonb not null,
  at_ms double precision not null
);
create index if not exists events_trace on app.events (trace_id);

-- A server span of one call: the operation's own span and every span beneath it. `ended_ms` is epoch milliseconds
-- by the Worker's clock, which moves only on I/O.
create table if not exists app.spans (
  id bigint generated always as identity primary key,
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  name text not null,
  outcome text not null,
  duration_ms double precision not null,
  ended_ms double precision not null
);
create index if not exists spans_trace on app.spans (trace_id);
