-- Per-organization tables from before the concepts, applied by migrate.ts right after Organizations
-- (organizations.cutover-migrate-order): each references the target app.organizations by org_id.
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
  at timestamptz not null default now(), primary key (org_id, id)
);
