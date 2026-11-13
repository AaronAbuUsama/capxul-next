-- The app schema of the placeholder Core: enough to show that a world's database is migrated when it is created and
-- that its rows travel to a world forked from it. The real Core brings its own migrations directory.
create schema app;
create table app.notes (
  id bigint generated always as identity primary key,
  world text not null,
  note text not null,
  written_at timestamptz not null default now()
);
