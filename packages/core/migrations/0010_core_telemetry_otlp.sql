-- The tap: in a test world, every OTLP body Core exports to the collector is also kept here, as the same JSON
-- (src/telemetry/export.ts), so a run can be read back from the world's database by trace id, beside `app.spans`.
-- A body of traces or logs is kept once per trace it carries, whole; a body of metrics once, with no trace id.
-- Written after the answer has left, so a row may land a moment after the call's answer. A real world has no tap.
create schema if not exists telemetry;

create table if not exists telemetry.otlp (
  id bigint generated always as identity primary key,
  trace_id text,
  signal text not null check (signal in ('traces', 'logs', 'metrics')),
  body jsonb not null,
  written_at timestamptz not null default now()
);
create index if not exists otlp_trace on telemetry.otlp (trace_id);
