-- What Core keeps of each company it founded (org.create) and of each change to its officers (org.member.grant), in
-- the world's `app` schema. The world's list of companies and their sites is `app.companies` (0002_world.sql), which
-- org.create adds to; this is the rest. Applied when a world is created.

create table if not exists app.organizations (
  org text primary key,
  handle text not null unique,
  founder text not null,
  founder_safe text not null,
  safe text not null,
  -- The founding as it was asked, encoded: the same founding again resumes it, any other is FoundingChanged.
  founding jsonb not null,
  -- Every founding Director, the founder first, and how many must sign.
  directors jsonb not null,
  threshold integer not null,
  members jsonb not null,
  -- awaiting_signatures until the setup's transaction lands, then ready.
  setup text not null,
  -- What deployMoney made: the hats (board, director, one officer hat per permission), the Gate and Roles.
  deployment jsonb not null,
  -- The company's top budget, whose hat is Books, once the setup has landed: what a payment from the Safe spends.
  budget text,
  -- The company's site on the bench, once the bench's door has started making it.
  site text,
  founded_ms double precision not null
);

create table if not exists app.officer_changes (
  change text primary key,
  org text not null references app.organizations (org),
  member text not null,
  permission text not null,
  -- What the Directors read when they approve. Never in an event.
  note text,
  proposal text not null unique,
  nonce integer not null,
  -- proposed until its transaction lands, then executed.
  state text not null
);
create index if not exists officer_changes_waiting on app.officer_changes (org, member) where state = 'proposed';

-- What a company's site must be told, in order: its company and Safe, each hat a person of the world wears, and the
-- founder's capital. Kept until the site has taken it, because a site is still being made when the setup lands.
create table if not exists app.site_deliveries (
  id bigint generated always as identity primary key,
  org text not null references app.organizations (org),
  kind text not null,
  body jsonb not null,
  delivered boolean not null default false
);
create index if not exists site_deliveries_pending on app.site_deliveries (org, id) where not delivered;
