-- Only Capxul's names and proposal identity. Amounts/spends/closed state remain chain-owned.
create table if not exists app.budgets (
  org_id text not null, budget_ref text not null,
  kind text not null check (kind in ('department','allowance')),
  key text not null, key_claim text, name text not null, parent_budget_id text,
  token text not null, period text not null check (period in ('month','quarter','year')),
  budget_id text, hat_id text not null, admin_hat_id text not null,
  status text not null check (status in ('proposed','active','abandoned')),
  created_change_id text not null,
  created_at double precision not null, updated_at double precision not null,
  primary key (org_id,budget_ref)
);
create unique index if not exists budgets_by_org_key_claim on app.budgets (org_id,key_claim);
create unique index if not exists budgets_by_org_budget_id on app.budgets (org_id,budget_id);
create index if not exists budgets_by_org_kind_ref on app.budgets (org_id,kind,budget_ref);
alter table app.budgets enable row level security;
alter table app.budgets force row level security;
drop policy if exists tenant on app.budgets;
create policy tenant on app.budgets to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
grant select,insert,update on app.budgets to capxul_core,capxul_worker;
revoke delete,truncate on app.budgets from capxul_core,capxul_worker;
