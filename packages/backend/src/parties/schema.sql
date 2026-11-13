-- Global namespace. Released births retain their historical address but reserve nothing.
create table if not exists app.parties (
  party_id text primary key,
  kind text not null check (kind in ('person','agent','organization','address')),
  state text not null check (state in ('provisional','outside','pending','active','released')),
  handle text, display_name text, photo_file_id text,
  safe_address text not null check (safe_address ~ '^0x[0-9a-f]{40}$' and safe_address <> '0x0000000000000000000000000000000000000000'),
  mailbox_digest text,
  owner_kind text check (owner_kind in ('person','organization')), owner_id text,
  created_at bigint not null, updated_at bigint not null,
  check ((owner_kind is null) = (owner_id is null)),
  check (state <> 'released' or handle is null)
);
create unique index if not exists "parties-by-handle" on app.parties(handle);
create unique index if not exists "parties-by-safe" on app.parties(safe_address) where state <> 'released';
create unique index if not exists "parties-by-mailbox" on app.parties(mailbox_digest);
create index if not exists "parties-by-owner" on app.parties(owner_kind,owner_id,kind);

-- party_transitioned goes to the canonical app.transition_outbox (platform/outbox.sql, migrated first).
drop table if exists app.party_events;
revoke all on app.parties from public, capxul_core, capxul_worker;
grant select on app.parties to capxul_core, capxul_worker;
grant insert,update on app.parties to capxul_worker;
