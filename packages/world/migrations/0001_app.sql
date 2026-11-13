-- The `fresh` proof's own table (src/proofs/fresh.ts): enough to show that a world's database is migrated when it is
-- created and that its rows travel to a world forked from it. A world's Core brings its own migrations (packages/core).
create schema app;
create table app.notes (
  id bigint generated always as identity primary key,
  world text not null,
  note text not null,
  written_at timestamptz not null default now()
);
