-- The tap: in a test world, the traces and logs Core exports to the collector are also kept here, as the same OTLP
-- JSON (src/telemetry/export.ts), so a run can read them back from the world's database beside `app.spans`.
--
-- One row per trace id an exported body carries, the body whole: a reader filters its spans and logs by trace id.
-- Metrics carry no trace and are not kept. Every row of one request is written in ONE statement, after the request's
-- answer has left and every exporter has flushed: so a reader that sees a call's operation span sees every span and
-- log of its request with it. A real world has no tap.
create schema if not exists telemetry;

create table if not exists telemetry.otlp (
  id bigint generated always as identity primary key,
  trace_id text not null,
  signal text not null check (signal in ('traces', 'logs')),
  body jsonb not null,
  written_at timestamptz not null default now()
);
-- A call's or a step's read, by trace id; and a whole run's read, by when the rows were written.
create index if not exists otlp_trace on telemetry.otlp (trace_id);
create index if not exists otlp_written on telemetry.otlp (written_at);
