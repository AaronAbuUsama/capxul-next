-- What a world is, kept in its own database so that its Core and the platform read the same facts: its chain's id and
-- contracts, its cast and its companies. The platform writes them when it creates the world (packages/world,
-- src/platform); a world made from a snapshot carries its source's rows. Its owner and expiry are the registry's
-- (packages/world, src/lifecycle/claim.ts); its grade and parent are what its record's latest `world_created` carried;
-- its clock is `app.clock` (0002_site_ops.sql). The record is app.events in the order of its ids (0001_telemetry.sql):
-- an entry's position is its rank there.

-- The world's clock, exactly as 0002_site_ops.sql declares it (packages/core/src/site-ops/clock.ts), for as long as
-- that migration is not on this branch: once it is, this statement does nothing and goes.
create table if not exists app.clock (
  id smallint primary key default 1 check (id = 1),
  mode text not null check (mode in ('frozen', 'running')),
  frozen_at_ms double precision,
  offset_ms double precision not null default 0
);

-- One row: the world's chain's id and the addresses its claims read.
create table if not exists app.world (
  one boolean primary key default true check (one),
  chain_id integer not null,
  contracts jsonb not null
);

-- The world's cast: each person's email (which Core's site operations read), the address that signs for them and
-- their claimed personal Safe, if any.
create table if not exists app.cast (
  person text primary key,
  position integer not null,
  email text not null,
  signer text not null,
  safe text
);

-- The world's companies, in the order they were founded, and each one's site. org.create adds a company here.
create table if not exists app.companies (
  org text primary key,
  position bigint generated always as identity,
  handle text not null unique,
  name text not null,
  site_state text not null,
  site_url text
)
