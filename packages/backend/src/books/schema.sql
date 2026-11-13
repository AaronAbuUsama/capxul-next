-- Core evidence only. ERPNext owns the chart, accounting settings and ledger.
create table if not exists app.book_feeds (
  org_id text primary key,
  last_seq integer not null check (last_seq >= 0),
  created_at double precision not null,
  updated_at double precision not null
);
create table if not exists app.book_annotations (
  owner_kind text not null check (owner_kind in ('person','organization')),
  owner_id text not null,
  reference_kind text not null check (reference_kind in ('payment','movement')),
  reference_id text not null,
  account text, account_number text,
  party_type text check (party_type in ('Customer','Supplier','Employee','Shareholder')),
  party_id text, cost_center text, project text,
  "references" jsonb not null check (jsonb_typeof("references")='array'),
  suggestion text, memo text,
  status text not null check (status in ('waiting','decided')),
  last_editor_kind text not null check (last_editor_kind in ('person','agent','system')),
  last_editor_id text not null,
  created_at double precision not null, updated_at double precision not null,
  primary key (owner_kind,owner_id,reference_kind,reference_id)
);
create index if not exists book_annotations_by_owner_status_account
  on app.book_annotations (owner_kind,owner_id,status,account,updated_at);
create table if not exists app.book_facts (
  org_id text not null, fact_id text not null, seq integer not null check (seq > 0),
  kind text not null check (kind in ('account_assigned','recategorized','rows_reclassified',
    'accrual_posted','accrual_cancelled','payment_settled','payment_received','deposit_received',
    'payment_sent_outside','payout_returned','opening_balance','reversed')),
  occurred_at double precision not null, recorded_at double precision not null,
  account text, from_account text,
  reference_kind text check (reference_kind in ('payment','movement')), reference_id text,
  rows jsonb not null check (jsonb_typeof(rows)='array'),
  money_key text, generation double precision,
  direction text check (direction in ('in','out')),
  asset_id text, symbol text, decimals double precision, amount_raw text, fee_raw text,
  usd_value text, usd_rate text, usd_source text,
  safe_address text, counterparty text, party_id text,
  source_kind text check (source_kind in ('payment','deposit','payout','movement','agreement','asset','payroll_run')),
  source_id text, chain_id double precision, block_number double precision, tx_hash text,
  log_index double precision, reverses_fact_id text,
  actor_kind text not null check (actor_kind in ('person','agent','system')), actor_id text,
  primary key (org_id,fact_id)
);
create unique index if not exists book_facts_by_org_seq on app.book_facts (org_id,seq);
create index if not exists book_facts_by_org_occurred on app.book_facts (org_id,occurred_at,fact_id);
create index if not exists book_facts_by_org_kind_occurred on app.book_facts (org_id,kind,occurred_at,fact_id);
create index if not exists book_facts_by_org_source on app.book_facts (org_id,source_kind,source_id,occurred_at);
create unique index if not exists book_facts_by_org_money_key on app.book_facts (org_id,money_key,generation,kind);
create index if not exists book_facts_by_org_reference on app.book_facts (org_id,reference_kind,reference_id);
create index if not exists book_facts_by_org_asset on app.book_facts (org_id,asset_id,occurred_at);

alter table app.book_feeds enable row level security;
alter table app.book_feeds force row level security;
alter table app.book_facts enable row level security;
alter table app.book_facts force row level security;
alter table app.book_annotations enable row level security;
alter table app.book_annotations force row level security;
drop policy if exists tenant on app.book_feeds;
create policy tenant on app.book_feeds to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
drop policy if exists tenant on app.book_facts;
create policy tenant on app.book_facts to capxul_core,capxul_worker
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
drop policy if exists tenant on app.book_annotations;
create policy tenant on app.book_annotations to capxul_core,capxul_worker
  using (owner_kind=coalesce(nullif(current_setting('app.owner_kind',true),''),'organization')
    and owner_id=coalesce(nullif(current_setting('app.owner_id',true),''),current_setting('app.org_id',true)))
  with check (owner_kind=coalesce(nullif(current_setting('app.owner_kind',true),''),'organization')
    and owner_id=coalesce(nullif(current_setting('app.owner_id',true),''),current_setting('app.org_id',true)));
grant select,insert,update on app.book_feeds,app.book_annotations to capxul_core,capxul_worker;
grant select,insert on app.book_facts to capxul_core,capxul_worker;
revoke update,delete,truncate on app.book_facts from capxul_core,capxul_worker;
revoke delete,truncate on app.book_feeds,app.book_annotations from capxul_core,capxul_worker;
