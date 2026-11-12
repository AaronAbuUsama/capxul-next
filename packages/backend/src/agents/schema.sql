create table if not exists app.agents (
  owner_id text not null, owner_kind text not null check(owner_kind in ('person','organization')),
  agent_id text not null, party_id text not null,
  safe_address text not null check(safe_address ~ '^0x[0-9a-f]{40}$'),
  signer_address text not null check(signer_address ~ '^0x[0-9a-f]{40}$'),
  key_store text not null check(key_store in ('file','env','host')),
  state text not null check(state in ('creating','active','frozen','removed','failed')),
  created_by text not null, created_at timestamptz not null, activated_at timestamptz,
  ended_at timestamptz, updated_at timestamptz not null,
  primary key(owner_id,agent_id)
);
create index if not exists agents_by_owner_created on app.agents(owner_id,owner_kind,created_at,agent_id);
create unique index if not exists agents_by_id on app.agents(agent_id);
create unique index if not exists agents_by_safe on app.agents(safe_address);
create unique index if not exists agents_by_party on app.agents(party_id);
create index if not exists agents_by_signer on app.agents(signer_address);
alter table app.agents enable row level security;
alter table app.agents force row level security;
drop policy if exists agents_read on app.agents;
create policy agents_read on app.agents for select to capxul_core using (
  (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true))
  or safe_address in (select safe_address from app.principals where person_id=current_setting('app.person_id',true))
);
drop policy if exists agents_service_read on app.agents;
create policy agents_service_read on app.agents for select to capxul_worker using(true);
revoke all on app.agents from public,capxul_core,capxul_worker;
grant select on app.agents to capxul_core,capxul_worker;
