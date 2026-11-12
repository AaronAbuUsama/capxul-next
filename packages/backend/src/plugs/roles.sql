create table if not exists app.site_users (
  org_id text not null references app.organizations,
  person_id text not null, address text not null, email text not null, name text not null,
  frappe_user text not null, created_by_grant_id text not null,
  status text not null check (status in ('active','disabled')),
  created_at double precision not null, updated_at double precision not null,
  primary key (org_id,person_id),
  unique (org_id,address), unique (org_id,frappe_user)
);
create table if not exists app.role_grants (
  org_id text not null references app.organizations,
  grant_id text not null, person_id text not null, address text not null, hat text not null,
  department text, roles text[] not null, map_version text not null,
  chain_tx_hash text not null, chain_log_index double precision not null,
  status text not null check (status in ('pending','applied','failed','revoked')),
  failure text, created_at double precision not null, updated_at double precision not null,
  primary key (org_id,grant_id),
  unique (org_id,chain_tx_hash,chain_log_index),
  foreign key (org_id,person_id) references app.site_users (org_id,person_id)
);
create index if not exists role_grants_by_person on app.role_grants (org_id,person_id,status);

alter table app.site_users enable row level security;
alter table app.site_users force row level security;
drop policy if exists plugs_role_owner on app.site_users;
create policy plugs_role_owner on app.site_users to capxul_core,capxul_worker
  using (current_user='capxul_worker' or
    (current_setting('app.owner_kind',true)='organization' and org_id=current_setting('app.owner_id',true)))
  with check (current_user='capxul_worker');
alter table app.role_grants enable row level security;
alter table app.role_grants force row level security;
drop policy if exists plugs_role_owner on app.role_grants;
create policy plugs_role_owner on app.role_grants to capxul_core,capxul_worker
  using (current_user='capxul_worker' or
    (current_setting('app.owner_kind',true)='organization' and org_id=current_setting('app.owner_id',true)))
  with check (current_user='capxul_worker');
grant select on app.site_users,app.role_grants to capxul_core;
grant select,insert,update on app.site_users,app.role_grants to capxul_worker;
