create table if not exists app.admissions (
  email text primary key, person_id text references app.principals,
  status text not null check(status in ('waiting','admitted')), note text,
  joined_via text not null check(joined_via in ('waitlist','operator','referral','invitation','escrow','fde-guest','reward')),
  requested_at double precision, admitted_at double precision, admitted_by text, updated_at double precision not null,
  check ((status='waiting' and admitted_at is null and admitted_by is null) or
    (status='admitted' and admitted_at is not null and admitted_by is not null))
);
create table if not exists app.referrals (
  referrer_email text not null, referee_email text not null unique,
  via text not null check(via in ('link','invite')),
  stage text not null check(stage in ('attributed','admitted','qualified','rewarded','voided')),
  attributed_at double precision not null, admitted_at double precision, qualified_at double precision,
  rewarded_at double precision, reward_kind text check(reward_kind in ('invites','admission')),
  voided_at double precision, void_reason text check(void_reason in ('disposable_email','operator')),
  primary key(referrer_email,referee_email)
);
create index if not exists referrals_by_referrer_attributed on app.referrals(referrer_email,attributed_at);
create table if not exists app.personal_safes (
  person_id text primary key references app.principals, email text not null,
  safe_address text not null unique, signer_address text not null,
  status text not null check(status in ('claiming','collecting','ready','failed')),
  attempt integer not null check(attempt>0), claim_tx_hash text, claimed_at double precision,
  claimed_block double precision, collect_approval_id text, collected integer not null check(collected>=0),
  failure_code text check(failure_code in ('WRONG_STATE','INVALID_INPUT','TRANSACTION_FAILED','PROVIDER_ERROR')),
  created_at double precision not null, updated_at double precision not null
);
-- Private routing metadata for the common outbox; not a second event transport.
-- Random keys let notices resolve unlisted mailboxes without exposing them in event properties.
create table if not exists app.account_event_sources (
  entity_id text primary key, kind text not null check(kind in ('admission','referral')),
  mailbox text not null, unique(kind,mailbox)
);
alter table app.admissions enable row level security;
alter table app.admissions force row level security;
alter table app.referrals enable row level security;
alter table app.referrals force row level security;
alter table app.personal_safes enable row level security;
alter table app.personal_safes force row level security;
alter table app.account_event_sources enable row level security;
alter table app.account_event_sources force row level security;
drop policy if exists admission_read on app.admissions;
create policy admission_read on app.admissions for select to capxul_core using(email=current_setting('app.email',true));
drop policy if exists referral_read on app.referrals;
create policy referral_read on app.referrals for select to capxul_core using(referrer_email=current_setting('app.email',true));
drop policy if exists personal_safe_read on app.personal_safes;
create policy personal_safe_read on app.personal_safes for select to capxul_core using(person_id=current_setting('app.person_id',true));
drop policy if exists admission_worker on app.admissions;
create policy admission_worker on app.admissions to capxul_worker using(true) with check(true);
drop policy if exists referral_worker on app.referrals;
create policy referral_worker on app.referrals to capxul_worker using(true) with check(true);
drop policy if exists personal_safe_worker on app.personal_safes;
create policy personal_safe_worker on app.personal_safes to capxul_worker using(true) with check(true);
drop policy if exists account_source_worker on app.account_event_sources;
create policy account_source_worker on app.account_event_sources to capxul_worker using(true) with check(true);
grant select on app.admissions,app.referrals,app.personal_safes to capxul_core;
grant select,insert,update on app.admissions,app.referrals,app.personal_safes to capxul_worker;
grant select,insert on app.account_event_sources to capxul_worker;
