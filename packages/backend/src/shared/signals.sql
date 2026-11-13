-- The wide rows (signals.wide-rows) and process_queue_age samples a world keeps for its operator alerts
-- (signals.world-rows). Worker-only: no tenant reads or writes them, and nothing updates one.
create table if not exists app.signal_rows (
  id bigint generated always as identity primary key,
  body text not null check (body in ('operation_row','process_row','process_queue_age')),
  at bigint not null,
  trace_id text,
  org_id text,
  attributes jsonb not null
);
create index if not exists signal_rows_body_at on app.signal_rows (body, at);
alter table app.signal_rows enable row level security;
alter table app.signal_rows force row level security;
drop policy if exists signal_rows_worker on app.signal_rows;
create policy signal_rows_worker on app.signal_rows to capxul_worker using (true) with check (true);
grant select,insert,delete on app.signal_rows to capxul_worker;
grant usage on sequence app.signal_rows_id_seq to capxul_worker;
