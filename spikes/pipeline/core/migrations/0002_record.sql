-- The world's one record: append-only entries numbered from 1 with no gaps, and the head they are numbered from.

-- An entry of the record. Its seq and its key are each unique, whatever two appends do at once. The body is kept
-- as `json`, not `jsonb`: the text the caller appended, exactly, including escapes that `jsonb` refuses.
-- A seq never leaves the range the contract's integer can carry without loss.
create table if not exists app.record_entries (
  seq bigint primary key check (seq between 1 and 9007199254740991),
  key text not null unique,
  kind text not null,
  body json not null
);

-- The record's head: the seq of the last accepted entry, 0 in a fresh world. It is one row, and every append
-- updates it first. That row lock is what makes appends take their turn: the next one waits for the commit or the
-- rollback of the one before, and only then reads the seq it follows.
create table if not exists app.record_head (
  the_head boolean primary key default true check (the_head),
  last_seq bigint not null check (last_seq >= 0)
);
insert into app.record_head (last_seq) values (0) on conflict (the_head) do nothing;
