create schema if not exists app;
create table if not exists app.schema_version (version integer primary key);
insert into app.schema_version values (1) on conflict do nothing;
-- The world's base, applied first (organizations.cutover-migrate-order). The per-organization tables are in
-- schema-per-org.sql, applied after Organizations creates app.organizations.
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
  chain_id integer primary key, indexed_block numeric not null, last_advance_at timestamptz not null default now()
);
