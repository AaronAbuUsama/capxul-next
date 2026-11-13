-- Run on the shared migration's checked-out admin transaction, before replacing the old org policy.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='app' and table_name='approvals' and column_name='request') then
    if to_regclass('app.site_payment_approvals') is not null then
      raise exception 'legacy approval destination already exists';
    end if;
    alter table app.approvals rename to site_payment_approvals;
    alter table app.site_payment_approvals rename constraint approvals_pkey to site_payment_approvals_pkey;
  end if;
end $$;
create table if not exists app.approvals (
  person_id text not null, approval_id text not null, state text not null check (state in
    ('sponsoring','pending','signed','sending','sent','landed','reverted','displaced','expired','declined','refused','withdrawn')),
  org_id text, opener text not null check (opener in ('accounts','organizations','board','agents','budgets','payments','payroll','equity')),
  subject_kind text not null, subject_id text not null, chain_id integer not null, sender text not null,
  calls jsonb not null check (jsonb_typeof(calls)='array' and jsonb_array_length(calls)>0), summary jsonb not null,
  deadline timestamptz not null, send_after timestamptz, needs jsonb not null, gate text, replaces text,
  nonce_key text not null check (nonce_key ~ '^[0-9]+$' and nonce_key::numeric > 0 and nonce_key::numeric < power(2::numeric,192)),
  nonce text, signer_address text, user_operation jsonb, digest text, user_op_hash text,
  valid_after timestamptz, valid_until timestamptz, signature text, send_error jsonb, refusal jsonb,
  transaction_hash text, block_number integer, displaced_by text, created_at timestamptz not null,
  reviewed_at timestamptz, signed_at timestamptz, sent_at timestamptz, ended_at timestamptz, updated_at timestamptz not null,
  primary key (person_id,approval_id)
);
create unique index if not exists approvals_by_id on app.approvals (approval_id);
create index if not exists approvals_by_subject on app.approvals (person_id,opener,subject_id);
create index if not exists approvals_by_sender_nonce on app.approvals (chain_id,sender,nonce);
-- Only scheduling metadata: the approval is the sole source of operation and send state.
create table if not exists app.approval_carriers (
  approval_id text primary key references app.approvals(approval_id), person_id text not null,
  trace_id text not null, wake_at timestamptz not null, attempts integer not null default 0, revision bigint not null default 0
);
alter table app.approval_carriers add column if not exists wake_version bigint not null default 0;
alter table app.approvals enable row level security;
alter table app.approvals force row level security;
drop policy if exists tenant on app.approvals;
create policy tenant on app.approvals to capxul_core,capxul_worker
  using (person_id=current_setting('app.person_id',true) or current_user='capxul_worker')
  with check (person_id=current_setting('app.person_id',true) or current_user='capxul_worker');
alter table app.approval_carriers enable row level security;
alter table app.approval_carriers force row level security;
drop policy if exists tenant on app.approval_carriers;
create policy tenant on app.approval_carriers to capxul_core,capxul_worker
  using (person_id=current_setting('app.person_id',true) or current_user='capxul_worker')
  with check (person_id=current_setting('app.person_id',true) or current_user='capxul_worker');
grant select,insert,update on app.approvals,app.approval_carriers to capxul_core,capxul_worker;
grant delete on app.approval_carriers to capxul_core,capxul_worker;

-- Request identity only; signing state remains solely on approvals.
create table if not exists app.approval_calls (
  person_id text not null, call_id text not null, request jsonb not null, trace_id text not null,
  at double precision not null, primary key(person_id,call_id)
);
alter table app.approval_calls enable row level security;
alter table app.approval_calls force row level security;
drop policy if exists tenant on app.approval_calls;
create policy tenant on app.approval_calls to capxul_core,capxul_worker
  using (person_id=current_setting('app.person_id',true) or current_user='capxul_worker')
  with check (person_id=current_setting('app.person_id',true) or current_user='capxul_worker');
grant select,insert on app.approval_calls to capxul_core,capxul_worker;
