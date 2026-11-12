create table if not exists app.payment_commands (
  owner_id text not null, owner_kind text not null check (owner_kind in ('person','organization')),
  id text not null, request_key text not null, request_digest text not null,
  route text not null check (route in ('personal','budget','board','claim_escrow','chain')),
  purpose text not null check (purpose in ('payment','department','reschedule','request','bank_payout','payroll','seats','fde_hosting')),
  requested_by text not null, approval_id text, proposal_id text, not_after double precision, created_at double precision not null,
  primary key (owner_id,owner_kind,id), unique (owner_id,owner_kind,request_key)
);
create table if not exists app.payments (
  owner_id text not null, owner_kind text not null check (owner_kind in ('person','organization')),
  id text not null, command_id text, origin text not null check (origin in ('prepared','chain')),
  route text not null check (route in ('personal','budget','board','claim_escrow','chain')),
  status text not null check (status in ('prepared','scheduled','due','escrowed','submitted','needs_retry','settled','mismatched','cancelled')),
  outcome text check (outcome in ('declined','refused','rejected','expired','displaced','reverted','window_closed','voided','budget_cancelled','refunded','withdrawn')),
  kind integer not null, chain_id integer not null, chain_payment_id text not null, job_nonce text not null,
  payer_safe text not null, payer_label text not null, payee_kind text check (payee_kind in ('person','organization')), payee_id text,
  payee_safe text not null, payee_label text not null, payee_mailbox text,
  token_address text not null, asset text not null, decimals integer not null, amount_raw text not null,
  document_id text, document_hash text not null, pay_at double precision, budget_id text, scheduled_id text,
  escrow_address text, funding_payment_id text, against jsonb, payee_against jsonb, source jsonb, fee_raw text,
  approval_id text, proposal_id text, cancel_approval_id text, cancel_proposal_id text, rescheduled_from text,
  shortfall text check (shortfall in ('balance_too_low','budget_exhausted')), mismatch text,
  settled_tx_hash text, settled_log_index integer, settled_block_number integer, settled_block_hash text, settled_at double precision,
  created_at double precision not null, updated_at double precision not null,
  primary key (owner_id,owner_kind,id)
);
create index if not exists "payments-by-owner-created" on app.payments(owner_id,owner_kind,created_at);
create index if not exists "payments-by-owner-scheduled" on app.payments(owner_id,owner_kind,status,pay_at);
create index if not exists "payments-by-owner-command" on app.payments(owner_id,owner_kind,command_id);
create index if not exists "payments-by-owner-approval" on app.payments(owner_id,owner_kind,approval_id);
create index if not exists "payments-by-payee-created" on app.payments(payee_id,payee_kind,created_at);
create unique index if not exists "payments-by-chain-payment-id" on app.payments(chain_id,chain_payment_id);
create unique index if not exists "payments-by-funding-payment-id" on app.payments(chain_id,funding_payment_id);
create unique index if not exists "payments-by-settled-log" on app.payments(chain_id,settled_tx_hash,settled_log_index);
create table if not exists app.movements (
  owner_id text not null, owner_kind text not null check (owner_kind in ('person','organization')),
  chain_id integer not null, tx_hash text not null, log_index integer not null, side text not null check (side in ('in','out')),
  safe text not null, counterparty text not null, token_address text not null, amount_raw text not null,
  block_number integer not null, block_hash text not null, block_time double precision not null,
  status text not null check (status in ('recorded','removed')), created_at double precision not null, updated_at double precision not null,
  primary key(owner_id,owner_kind,chain_id,tx_hash,log_index,side)
);
create index if not exists "movements-by-owner-time" on app.movements(owner_id,owner_kind,block_time);
create index if not exists "movements-by-log" on app.movements(chain_id,tx_hash,log_index);

alter table app.payment_commands enable row level security;
alter table app.payment_commands force row level security;
alter table app.payments enable row level security;
alter table app.payments force row level security;
alter table app.movements enable row level security;
alter table app.movements force row level security;
drop policy if exists owner_read on app.payment_commands;
create policy owner_read on app.payment_commands for select to capxul_core using (
  owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)
);
drop policy if exists owner_read on app.payments;
create policy owner_read on app.payments for select to capxul_core using (
  (owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)) or
  (payee_kind=current_setting('app.owner_kind',true) and payee_id=current_setting('app.owner_id',true))
);
drop policy if exists owner_read on app.movements;
create policy owner_read on app.movements for select to capxul_core using (
  owner_kind=current_setting('app.owner_kind',true) and owner_id=current_setting('app.owner_id',true)
);
drop policy if exists worker on app.payment_commands;
create policy worker on app.payment_commands to capxul_worker using (true) with check (true);
drop policy if exists worker on app.payments;
create policy worker on app.payments to capxul_worker using (true) with check (true);
drop policy if exists worker on app.movements;
create policy worker on app.movements to capxul_worker using (true) with check (true);
grant select on app.payment_commands,app.payments,app.movements to capxul_core;
grant select,insert,update on app.payment_commands,app.payments,app.movements to capxul_worker;
