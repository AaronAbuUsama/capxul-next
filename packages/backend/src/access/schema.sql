-- Access owns identity, opaque sessions, sign-in state and the synced gate copy.
create table if not exists app.principals (
  person_id text primary key, kind text not null check (kind in ('person','agent')),
  email text unique, safe_address text not null unique, signer_address text,
  created_at timestamptz not null,
  check ((kind='person' and email is not null and signer_address is null) or
    (kind='agent' and email is null and signer_address is not null))
);
create table if not exists app.sign_in_codes (
  email text primary key, code_hash text not null, attempts_left integer not null check (attempts_left between 0 and 3),
  expires_at timestamptz not null, sent_at timestamptz not null
);
create table if not exists app.sessions (
  person_id text not null references app.principals, session_id text not null,
  token_hash text not null unique, method text not null check (method in ('code','key')),
  status text not null check (status in ('active','revoked','expired')), challenge_nonce text unique,
  client text not null, created_at timestamptz not null, expires_at timestamptz not null, ended_at timestamptz,
  primary key (person_id,session_id)
);
create index if not exists sessions_by_status_expiry on app.sessions(status,expires_at);
create table if not exists app.feature_flags (
  key text primary key, active boolean not null, target text not null check (target in ('person','organization')),
  rules jsonb not null check (jsonb_typeof(rules)='array'), unsupported text, checked_at timestamptz not null
);
alter table app.principals enable row level security;
alter table app.principals force row level security;
alter table app.sessions enable row level security;
alter table app.sessions force row level security;
alter table app.sign_in_codes enable row level security;
alter table app.sign_in_codes force row level security;
alter table app.feature_flags enable row level security;
alter table app.feature_flags force row level security;
drop policy if exists principal_read on app.principals;
create policy principal_read on app.principals for select to capxul_core
  using (person_id=current_setting('app.person_id',true));
drop policy if exists session_read on app.sessions;
create policy session_read on app.sessions for select to capxul_core
  using (person_id=current_setting('app.person_id',true));
drop policy if exists flag_read on app.feature_flags;
create policy flag_read on app.feature_flags for select to capxul_core using (true);
drop policy if exists principal_worker on app.principals;
create policy principal_worker on app.principals to capxul_worker using (true) with check (true);
drop policy if exists session_worker on app.sessions;
create policy session_worker on app.sessions to capxul_worker using (true) with check (true);
drop policy if exists code_worker on app.sign_in_codes;
create policy code_worker on app.sign_in_codes to capxul_worker using (true) with check (true);
drop policy if exists flag_worker on app.feature_flags;
create policy flag_worker on app.feature_flags to capxul_worker using (true) with check (true);
grant select on app.principals,app.sessions,app.feature_flags to capxul_core;
grant select,insert on app.principals to capxul_worker;
grant update(signer_address) on app.principals to capxul_worker;
grant select,insert,update,delete on app.sessions,app.sign_in_codes,app.feature_flags to capxul_worker;
-- The only pre-tenant lookup is possession of an opaque bearer, never a caller-supplied person id.
-- This function is owned by the provisioning role, has a closed search path and no dynamic SQL.
create or replace function app.resolve_bearer(digest text, observed_at timestamptz)
returns table(person_id text,kind text,email text,safe_address text,signer_address text)
language sql security definer set search_path=pg_catalog,app as $$
  select p.person_id,p.kind,p.email,p.safe_address,p.signer_address
  from app.sessions s join app.principals p on p.person_id=s.person_id
  where s.token_hash=digest and s.status='active' and s.expires_at>observed_at
$$;
revoke all on function app.resolve_bearer(text,timestamptz) from public;
grant execute on function app.resolve_bearer(text,timestamptz) to capxul_core,capxul_worker;
