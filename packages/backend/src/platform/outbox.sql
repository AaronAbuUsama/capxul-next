create table if not exists app.transition_outbox (
  seq bigint generated always as identity unique,
  id text primary key check (id <> ''),
  event jsonb not null check (jsonb_typeof(event) = 'object' and event->>'id' = id),
  -- Host envelope stamps (runtime.outbox-host-stamps): RealTime epoch ms, written by Core, never read by a product rule.
  host_enqueued_at bigint not null check (host_enqueued_at > 0)
);
create index if not exists transition_outbox_name_seq on app.transition_outbox ((event->>'name'), seq);
create table if not exists app.transition_acks (
  consumer text not null check (consumer <> ''),
  event_id text not null references app.transition_outbox(id),
  -- The world instant the relay read for its batch; no column default reads a clock (time.no-direct-reads).
  acked_at timestamptz not null,
  host_acked_at bigint not null check (host_acked_at > 0),
  primary key (consumer, event_id)
);
-- A failing event's latest leading error code and attempts only (runtime.outbox-poison-event); no clock read, message or event data.
create table if not exists app.transition_failures (
  consumer text not null check (consumer <> ''),
  event_id text not null references app.transition_outbox(id),
  attempts integer not null check (attempts > 0),
  last_error text not null,
  primary key (consumer, event_id)
);

alter table app.transition_outbox enable row level security;
alter table app.transition_outbox force row level security;
drop policy if exists transition_owner on app.transition_outbox;
create policy transition_owner on app.transition_outbox to capxul_core, capxul_worker
  using (current_user = 'capxul_worker' or
    (event->>'owner_kind' = current_setting('app.owner_kind', true) and
     event->>'owner_id' = current_setting('app.owner_id', true)))
  with check (current_user = 'capxul_worker' or
    (event->>'owner_kind' = current_setting('app.owner_kind', true) and
     event->>'owner_id' = current_setting('app.owner_id', true)));
alter table app.transition_acks enable row level security;
alter table app.transition_acks force row level security;
drop policy if exists transition_worker on app.transition_acks;
create policy transition_worker on app.transition_acks to capxul_worker using (true) with check (true);
grant select, insert on app.transition_outbox to capxul_core, capxul_worker;
grant usage on sequence app.transition_outbox_seq_seq to capxul_core, capxul_worker;
grant select, insert on app.transition_acks to capxul_worker;
alter table app.transition_failures enable row level security;
alter table app.transition_failures force row level security;
drop policy if exists transition_failure_worker on app.transition_failures;
create policy transition_failure_worker on app.transition_failures to capxul_worker using (true) with check (true);
grant select, insert, update, delete on app.transition_failures to capxul_worker;
