create table if not exists app.transition_outbox (
  seq bigint generated always as identity unique,
  id text primary key check (id <> ''),
  event jsonb not null check (jsonb_typeof(event) = 'object' and event->>'id' = id)
);
create index if not exists transition_outbox_name_seq on app.transition_outbox ((event->>'name'), seq);
create table if not exists app.transition_acks (
  consumer text not null check (consumer <> ''),
  event_id text not null references app.transition_outbox(id),
  acked_at timestamptz not null default now(),
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
