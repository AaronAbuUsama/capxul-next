-- Provisioning only, inside the Core migration transaction. Never execute on resume/restore.
create table if not exists app.notices (
  recipient text not null check (recipient=lower(btrim(recipient)) and recipient<>''),
  notice_id text not null,
  template text not null check (template in (
    'beta-welcome','account-ready','organization-invitation','head-stalled','fde-ready','fde-guest-named','fde-hosting-due','fde-paused',
    'allowance-assigned','department-holder-added','department-holder-removed','director-seated','director-removed','threshold-changed',
    'proposal-waiting','officer-hat-granted','payment-scheduled','payment-scheduled-short','payment-scheduled-sent',
    'payment-scheduled-cancelled','payment-scheduled-failed','money-waiting','money-waiting-reminder','money-uncollected','money-taken-back',
    'agreement-offer','agreement-accepted','pay-changed','agreement-paused','agreement-resumed','agreement-ending','agreement-ended',
    'pay-received','collection-refused','pay-ready','low-balance-alert','payslip','leave-waiting','leave-approved','leave-rejected',
    'expense-claim-waiting','expense-claim-approved','expense-claim-rejected','expense-claim-paid','advance-waiting','advance-rejected',
    'advance-paid','person-verification','bank-verified','bank-payout-sent','bank-payout-delivered','bank-payout-returned',
    'invoice-received','invoice-to-pay','invoice-paid','invoice-receipt','invoice-declined','round-invitation')),
  subject_kind text not null check (subject_kind in (
    'admission','personal-safe','invitation','org-setup','org-head','budget-change','board-change','proposal','officer-change',
    'payment','agreement','agreement-write','salary-slip','leave-application','expense-claim','employee-advance',
    'verification','verification-person','bank-payout','request','investment','balance-alert')),
  subject_id text not null, cause text not null, person_id text, org_id text,
  facts jsonb not null check (jsonb_typeof(facts)='object'),
  status text not null check (status in ('sent','retrying','failed')),
  attempts integer not null check (attempts between 1 and 3),
  last_error jsonb check (last_error is null or (jsonb_typeof(last_error)='object' and last_error ?& array['code','message']
    and last_error->>'code' in ('PROVIDER_ERROR','RATE_LIMITED','INVALID_INPUT') and jsonb_typeof(last_error->'message')='string')),
  mail_id text, next_attempt_at double precision, created_at double precision not null, updated_at double precision not null,
  primary key (recipient,notice_id),
  check ((status='retrying' and next_attempt_at is not null and attempts<3) or (status<>'retrying' and next_attempt_at is null)),
  check (status<>'sent' or mail_id is not null)
);
create index if not exists by_recipient_changed on app.notices (recipient,updated_at);
create index if not exists by_template_changed on app.notices (template,updated_at);
create index if not exists by_changed on app.notices (updated_at);
alter table app.notices enable row level security;
alter table app.notices force row level security;
drop policy if exists mailbox on app.notices;
create policy mailbox on app.notices for select to capxul_core,capxul_worker
  using (recipient=nullif(current_setting('app.email',true),''));
revoke all on app.notices from public,capxul_core,capxul_worker,capxul_ponder;
grant select on app.notices to capxul_core,capxul_worker;

-- Named cross-mailbox index queries. Only the local-devnet command boundary may invoke these;
-- ordinary mailbox reads remain RLS scoped. Filtering precedes the limit, including old templates.
create or replace function app.notices_by_template_changed(kind text, mailbox text default null, maximum integer default 200)
returns setof app.notices language sql stable security definer set search_path=pg_catalog,app as $$
  select * from app.notices where template=kind and (mailbox is null or recipient=mailbox)
  order by updated_at desc,recipient,notice_id limit greatest(1,least(maximum,200))
$$;
create or replace function app.notices_by_changed(mailbox text default null, maximum integer default 200)
returns setof app.notices language sql stable security definer set search_path=pg_catalog,app as $$
  select * from app.notices where mailbox is null or recipient=mailbox
  order by updated_at desc,recipient,notice_id limit greatest(1,least(maximum,200))
$$;
revoke all on function app.notices_by_template_changed(text,text,integer),app.notices_by_changed(text,integer) from public;
grant execute on function app.notices_by_template_changed(text,text,integer),app.notices_by_changed(text,integer) to capxul_worker;

-- Private durable execution checkpoints, not delivery records or a public notices procedure.
create table if not exists app.notice_workflows (
  workflow text not null, event_id text not null, event jsonb not null,
  checkpoint jsonb, due_at double precision not null, finished_at double precision,
  failures integer not null default 0 check (failures between 0 and 6),
  retry_at double precision, failed_at double precision, last_error text,
  primary key (workflow,event_id)
);
create table if not exists app.notice_attempts (
  recipient text not null, notice_id text not null, intent jsonb not null,
  scheduled_attempts integer not null default 0 check (scheduled_attempts between 0 and 3),
  due_at double precision,
  primary key (recipient,notice_id)
);
revoke all on app.notice_workflows,app.notice_attempts from public,capxul_core,capxul_worker,capxul_ponder;
grant select,insert,update on app.notice_workflows,app.notice_attempts to capxul_worker;

-- The only delivery writer. Stale attempts are no-ops, including terminal-state and birth replays.
-- The caller appends the returned privacy-safe event to the shared outbox in the SAME transaction.
create or replace function app.notice_outcome(mailbox text, identity text, expected integer, result jsonb, instant double precision)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app as $$
declare
  job app.notice_attempts; prior app.notices; delivery app.notices;
  failure jsonb; accepted boolean; next_status text; movement text; attempts_now integer;
begin
  select * into job from app.notice_attempts where recipient=mailbox and notice_id=identity for update;
  if not found or job.scheduled_attempts<>expected or job.due_at is null or job.due_at>instant then return null; end if;
  select * into prior from app.notices where recipient=mailbox and notice_id=identity for update;
  if expected=0 and found then return null; end if;
  if expected>0 and (not found or prior.status<>'retrying' or prior.attempts<>expected) then return null; end if;
  accepted := coalesce(jsonb_typeof(result->'id')='string' and result->>'id'<>'',false);
  failure := result->'error';
  if not accepted and (coalesce(failure->>'code','') not in ('PROVIDER_ERROR','RATE_LIMITED','INVALID_INPUT')
      or jsonb_typeof(failure->'message') is distinct from 'string') then
    raise exception 'INVALID_INPUT: classified mail outcome required';
  end if;
  attempts_now := expected+1;
  next_status := case when accepted then 'sent' when failure->>'code'='INVALID_INPUT' or attempts_now=3 then 'failed' else 'retrying' end;
  movement := case when expected=0 then case next_status when 'sent' then 'send' when 'failed' then 'refuse' else 'hold' end
    else case next_status when 'sent' then 'deliver' when 'failed' then 'fail' else 'defer' end end;
  insert into app.notices values (
    mailbox,identity,job.intent->>'template',job.intent->>'subject_kind',job.intent->>'subject_id',job.intent->>'cause',
    job.intent->>'person_id',job.intent->>'org_id',job.intent->'facts',next_status,attempts_now,
    case when accepted then prior.last_error else failure end,case when accepted then result->>'id' else null end,
    case when next_status='retrying' then instant+case when attempts_now=1 then 60000 else 240000 end else null end,
    coalesce(prior.created_at,instant),instant
  ) on conflict (recipient,notice_id) do update set
    status=excluded.status,attempts=excluded.attempts,last_error=excluded.last_error,mail_id=excluded.mail_id,
    next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
  returning * into delivery;
  update app.notice_attempts set scheduled_attempts=attempts_now,due_at=delivery.next_attempt_at
    where recipient=mailbox and notice_id=identity;
  return jsonb_build_object('from',prior.status,'to',delivery.status,'transition',movement,'notice_id',identity,
    'template',delivery.template,'cause',delivery.cause,'attempts',delivery.attempts,
    'error_code',delivery.last_error->>'code','person_id',delivery.person_id,'org_id',delivery.org_id);
end $$;
revoke all on function app.notice_outcome(text,text,integer,jsonb,double precision) from public;
grant execute on function app.notice_outcome(text,text,integer,jsonb,double precision) to capxul_worker;
