-- Activity owns only this immutable log. Source events and consumer ACKs belong to the outbox runtime.
create table if not exists app.activity_changes (
  owner_id text not null,
  owner_kind text not null check (owner_kind in ('person','organization')),
  seq bigint not null check (seq > 0),
  row_kind text not null check (row_kind in ('payment','movement')),
  row_id text not null,
  change text not null check (change in ('new','updated')),
  transition text not null,
  "from" text,
  "to" text not null,
  event_id text not null,
  changed_at double precision not null,
  primary key (owner_id,owner_kind,seq)
);
create index if not exists activity_changes_by_owner_row
  on app.activity_changes (owner_id,owner_kind,row_kind,row_id,seq);
create unique index if not exists activity_changes_by_owner_event
  on app.activity_changes (owner_id,owner_kind,event_id);
alter table app.activity_changes enable row level security;
alter table app.activity_changes force row level security;
drop policy if exists activity_read on app.activity_changes;
create policy activity_read on app.activity_changes for select to capxul_core
  using (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true));
drop policy if exists activity_worker on app.activity_changes;
create policy activity_worker on app.activity_changes to capxul_worker
  using (true) with check (true);
revoke all on app.activity_changes from public,capxul_core,capxul_worker,capxul_ponder;
grant select on app.activity_changes to capxul_core;
grant select,insert on app.activity_changes to capxul_worker;
