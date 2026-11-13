-- Run after Core's migration, as its migration role. Runtime roles never own these tables.
create table if not exists app.sites (
  org_id text not null references app.organizations, site_id text not null, world_id text not null,
  slug text not null, host text not null, state text not null check (state in ('creating','ready','suspended','archived','failed')),
  bench text not null, app_version text, map_version text, failure text,
  created_at double precision not null, ready_at double precision, updated_at double precision not null,
  check (site_id=org_id),
  primary key (org_id,site_id)
);
create unique index if not exists "sites-by-host" on app.sites (host);
create index if not exists "sites-by-world" on app.sites (org_id,world_id);
create table if not exists app.site_features (
  org_id text not null references app.organizations, feature text not null
    check (feature in ('accounts','people','projects','crm','payroll','whatsapp','attendance','recruitment','reviews','stock','manufacturing')),
  state text not null check (state in ('off','on','switching')), wanted boolean not null,
  requested_by text, failure text, updated_at double precision not null,
  primary key (org_id,feature)
);
create index if not exists "site-features-by-state" on app.site_features (org_id,state);
create table if not exists app.door_calls (
  org_id text not null references app.organizations, call_id text not null, person_id text not null, verb text not null,
  doctype text, docname text, outcome text not null check (outcome in ('ok','refused','held','failed')),
  refusal text, created_at double precision not null,
  primary key (org_id,call_id)
);
create index if not exists "door-calls-by-person" on app.door_calls (org_id,person_id,created_at);
alter table app.sites enable row level security;
alter table app.sites force row level security;
alter table app.site_features enable row level security;
alter table app.site_features force row level security;
alter table app.door_calls enable row level security;
alter table app.door_calls force row level security;
drop policy if exists tenant on app.sites;
create policy tenant on app.sites to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
drop policy if exists tenant on app.site_features;
create policy tenant on app.site_features to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
drop policy if exists tenant on app.door_calls;
create policy tenant on app.door_calls to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
grant select,insert,update on app.sites,app.site_features,app.door_calls to capxul_core,capxul_worker;
-- The sole cross-tenant query is the declared unique hostname lookup. It cannot write or return site data.
create or replace function app.site_by_host(hostname text) returns table(org_id text,site_id text)
  language sql stable security definer set search_path=pg_catalog,pg_temp as
  'select s.org_id,s.site_id from app.sites s where s.host=hostname';
revoke all on function app.site_by_host(text) from public;
grant execute on function app.site_by_host(text) to capxul_worker;
