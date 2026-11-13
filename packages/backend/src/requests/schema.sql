create table if not exists app.requests (
  owner_kind text not null check (owner_kind in ('person','organization')), owner_id text not null,
  request_id text not null, request_key text not null, kind text not null check (kind in ('request','invoice','purchase')),
  status text not null check (status in ('open','paying','paid','declined','cancelled','expired')),
  issuer_party_id text not null, issuer_safe text not null, payer_kind text not null check (payer_kind in ('capxul','outside','none')),
  payer_party_id text, payer_email text, payer_safe text, asset_id text not null, token_address text not null,
  decimals integer not null, amount_raw text not null check (amount_raw ~ '^[0-9]+$' and amount_raw::numeric > 0),
  reference text not null check (length(reference) between 1 and 120), note text check (length(note)<=280),
  invoice jsonb, document_id text, document_hash text, expires_at double precision,
  service_id text, service_revision double precision, quantity double precision, escrow_address text,
  escrow_salt text, escrow_received_raw text, escrow_checked_at double precision, payout_tx_hash text,
  payment_id text, chain_payment_id text, pay_key text, deposit_id text, income jsonb, billed_logs jsonb,
  decided_by text, decided_at double precision, created_at double precision not null, updated_at double precision not null,
  primary key (owner_kind,owner_id,request_id)
);
create index if not exists requests_by_owner_created on app.requests (owner_kind,owner_id,created_at,request_id);
create unique index if not exists requests_by_owner_key on app.requests (owner_kind,owner_id,request_key);
create index if not exists requests_by_owner_open_token on app.requests (owner_kind,owner_id,status,token_address,created_at);
create index if not exists requests_by_owner_reference on app.requests (owner_kind,owner_id,reference);
create index if not exists requests_by_payer_created on app.requests (payer_safe,created_at,request_id);
create unique index if not exists requests_by_request on app.requests (request_id);
create unique index if not exists requests_by_chain_payment on app.requests (chain_payment_id);
create index if not exists requests_by_service_created on app.requests (service_id,created_at);
alter table app.requests enable row level security;
alter table app.requests force row level security;
drop policy if exists owner_read on app.requests;
drop policy if exists owner_insert on app.requests;
drop policy if exists owner_update on app.requests;
create policy owner_read on app.requests for select to capxul_core,capxul_worker
  using (current_user='capxul_worker' or
    (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)) or
    payer_safe=current_setting('app.safe_address',true));
create policy owner_insert on app.requests for insert to capxul_core,capxul_worker
  with check (current_user='capxul_worker' or
    (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)));
create policy owner_update on app.requests for update to capxul_core,capxul_worker
  using (current_user='capxul_worker' or
    (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)))
  with check (current_user='capxul_worker' or
    (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)));
grant select,insert,update on app.requests to capxul_core,capxul_worker;
