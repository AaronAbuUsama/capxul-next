create schema if not exists app;
create table if not exists app.schema_version (version integer primary key);
insert into app.schema_version values (1) on conflict do nothing;

create table if not exists app.organizations (
  org_id text primary key, name text not null, safe text not null unique, site text not null unique,
  admin_email text not null, token text not null, released boolean not null default false,
  next_seq bigint not null default 1, last_ack bigint not null default 0,
  retry_at timestamptz, failures integer not null default 0, request_cursor bigint not null default 0,
  collected_at timestamptz, collector_error text
);
create table if not exists app.people (
  org_id text not null references app.organizations, address text not null, email text not null, name text not null,
  personal_safe text,
  primary key (org_id, address), unique (org_id, email)
);
alter table app.people add column if not exists personal_safe text;
create unique index if not exists people_by_personal_safe on app.people (org_id,personal_safe);
create table if not exists app.hats (
  org_id text not null references app.organizations, hat_id text not null, name text not null, department text,
  primary key (org_id, hat_id)
);
create table if not exists app.approvals (
  org_id text not null references app.organizations, id text not null, request_id text not null,
  request jsonb not null, status text not null default 'pending' check (status in ('pending','submitted','settled','failed')),
  trace text not null, tx_hash text, created_at timestamptz not null default now(),
  primary key (org_id, id), unique (org_id, request_id)
);
create table if not exists app.site_events (
  org_id text not null references app.organizations, seq bigint not null, event_key text not null, kind text not null,
  data jsonb not null, trace text not null, state text not null default 'pending' check (state in ('pending','applied','parked')),
  attempts integer not null default 0, last_error text, last_attempt_at timestamptz, applied_at timestamptz,
  created_at timestamptz not null default now(), map_version text,
  primary key (org_id, seq), unique (org_id, event_key)
);
create table if not exists app.consumed_facts (
  org_id text not null references app.organizations, log_id text not null, primary key (org_id, log_id)
);
create table if not exists app.site_request_answers (
  org_id text not null references app.organizations, request_id text not null, request jsonb not null,
  answer jsonb not null, primary key (org_id, request_id)
);
create table if not exists app.transaction_traces (
  org_id text not null references app.organizations, tx_hash text not null, trace text not null,
  primary key (org_id, tx_hash)
);
create table if not exists app.records (
  org_id text not null references app.organizations, id bigint generated always as identity,
  kind text not null, trace text not null, data jsonb not null, previous_hash text not null, hash text not null,
  at timestamptz not null, primary key (org_id, id)
);
-- A record's time is the caller's world instant (platform/db.ts record()); worlds migrated before this keep no default.
alter table app.records alter column at drop default;
-- Indexer tables are rebuildable. App data deliberately has no FK into ponder.
create table if not exists app.world (
  singleton boolean primary key default true check (singleton), world_id text not null,
  epoch bigint not null default 1, clock jsonb not null default '{}', lineage jsonb
);
create table if not exists app.world_record (
  id bigint generated always as identity primary key, kind text not null, data jsonb not null,
  at timestamptz not null default now()
);
create table if not exists app.indexer_observation (
  chain_id integer primary key, indexed_block numeric not null, last_advance_at timestamptz not null
);
-- A host liveness age written from TS through RealTime (platform/diagnostics.ts); worlds migrated before this keep no default.
alter table app.indexer_observation alter column last_advance_at drop default;
