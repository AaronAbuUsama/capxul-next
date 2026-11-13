-- The world's clock and the documents Core made on its companies' sites (packages/core/src/site-ops). Applied when a
-- world is created, after 0001.

-- The world's clock: one row. A frozen clock holds its instant; a running one runs at rate 1 from host time plus its
-- offset (blueprint decisions.md, 20). No row is a running clock at host time. world.create writes the clock it
-- begins with; world.clock.warp moves it; world.show and every event's time read it.
create table if not exists app.clock (
  id smallint primary key default 1 check (id = 1),
  mode text not null check (mode in ('frozen', 'running')),
  frozen_at_ms double precision,
  offset_ms double precision not null default 0
);

-- Every document doc.create made, with the hash it answered: a payment held for it carries this hash (decisions.md,
-- 28). A world made from a snapshot keeps its source's rows with its database.
create table if not exists app.documents (
  org text not null,
  doctype text not null,
  name text not null,
  hash text not null,
  trace_id text not null,
  primary key (org, doctype, name)
);
