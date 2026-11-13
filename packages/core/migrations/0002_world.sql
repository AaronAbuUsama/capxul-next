-- What a world is, kept in its own database so that its Core and the platform read the same facts: its grade, its
-- chain's contracts, its parent, its clock, its cast and its companies. The platform writes the first five when it
-- creates or restores the world (packages/world, src/platform); a world made from a snapshot carries its source's
-- rows, and the restore rewrites its parent and its clock. The world's owner and expiry are not here: they are the
-- registry's (packages/world, src/lifecycle/claim.ts). The record is app.events in the order of its ids
-- (0001_telemetry.sql): an entry's position is its rank there.

-- One row: the world's grade, its chain's id and the addresses its claims read, and where it was made from.
create table if not exists app.world (
  one boolean primary key default true check (one),
  grade text not null,
  chain_id integer not null,
  contracts jsonb not null,
  parent jsonb
);

-- One row: the world's clock. Frozen, its time is world_ms. Running, it is world_ms plus the host time since host_ms.
create table if not exists app.clock (
  one boolean primary key default true check (one),
  mode text not null,
  world_ms double precision not null,
  host_ms double precision not null
);

-- The world's cast: each person's email, the address that signs for them and their claimed personal Safe, if any.
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
