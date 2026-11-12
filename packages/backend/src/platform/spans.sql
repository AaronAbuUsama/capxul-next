create table if not exists app.completed_spans (
  run_id text not null,
  world_id text not null,
  trace_id text not null,
  span_id text not null,
  event jsonb not null,
  primary key (run_id,world_id,trace_id,span_id),
  check (event->>'runId'=run_id and event->>'worldId'=world_id and event->>'traceId'=trace_id and event->>'spanId'=span_id)
);
alter table app.completed_spans enable row level security;
alter table app.completed_spans force row level security;
drop policy if exists spans_worker on app.completed_spans;
create policy spans_worker on app.completed_spans to capxul_worker using (true) with check (true);
grant select,insert on app.completed_spans to capxul_worker;
