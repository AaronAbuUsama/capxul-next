-- The world's own tables Core's chain operations read and write, as the world's migration declares them
-- (packages/core/migrations/0002_world.sql, on the platform builder's branch, which owns them). Only until that
-- migration is on this branch: then test/chain applies it instead and this file goes.
create table if not exists app.cast (
  person text primary key,
  position integer not null,
  email text not null,
  signer text not null,
  safe text
);
create table if not exists app.companies (
  org text primary key,
  position bigint generated always as identity,
  handle text not null unique,
  name text not null,
  site_state text not null,
  site_url text
);
