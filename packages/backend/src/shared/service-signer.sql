create table if not exists app.service_signer_sends (
  account text not null,
  chain_id bigint not null,
  request_key text not null,
  request_digest text not null,
  raw_transaction text not null,
  hash text not null,
  safe text not null,
  signer text not null,
  attempted boolean not null default false,
  receipt jsonb,
  primary key(account,chain_id,request_key),
  unique(chain_id,hash)
);
alter table app.service_signer_sends enable row level security;
alter table app.service_signer_sends force row level security;
drop policy if exists service_signer_worker on app.service_signer_sends;
create policy service_signer_worker on app.service_signer_sends to capxul_worker using (true) with check (true);
grant select,insert,update on app.service_signer_sends to capxul_worker;
