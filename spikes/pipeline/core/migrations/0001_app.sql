-- The world's `app` schema, as far as the pipeline spike needs it. Applied when a world is created.
create schema if not exists app;

-- A declared event, written in the same transaction as the change it reports.
create table if not exists app.events (
  id bigint generated always as identity primary key,
  trace_id text not null,
  operation text not null,
  event text not null,
  payload jsonb not null,
  at timestamptz not null
);
create index if not exists events_trace on app.events (trace_id);

-- A server span of one Rpc call, kept under the trace id the caller supplied.
create table if not exists app.spans (
  id bigint generated always as identity primary key,
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  name text not null,
  outcome text not null,
  duration_ms double precision not null,
  at timestamptz not null
);
create index if not exists spans_trace on app.spans (trace_id);
